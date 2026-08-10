import type { Card, LangText } from './types';
import { assetUrl, isListedBox } from './data';

const KEY = 'ember-inventory-v1';

const PEEK_MS = 1500;

const FACTION_SHORT: Record<string, string> = {
  RDL: 'RDL',
  UN: 'UN',
  GOF: 'GoF',
  PD: 'PD',
  COLLABORATION: 'Collab',
};

const SLOT_SHORT: Record<string, string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'L.Arm',
  rightHand: 'R.Arm',
  backpack: 'Pack',
  small: 'Drone',
  medium: 'Drone',
  large: 'Drone',
};

const CATEGORY_SHORT: Record<string, string> = {
  pilot: 'Pilot',
  drone: 'Drone',
  projectile: 'Proj',
  tactics_or_upgrade: 'Tactic',
  mech_part: 'Part',
};

const SLOT_ORDER = ['Torso', 'Chassis', 'L.Arm', 'R.Arm', 'Pack', 'Drone', 'Proj', 'Pilot', 'Tactic', 'Part'];

export interface BoxInfo {
  key: string;
  id: number;
  name: LangText;
  faction?: string[];
  hasImage?: boolean;
  released?: boolean;
  product?: string;
  // Declared so isListedBox can actually read it here. The objects handed in are
  // data.boxes itself, so the flag is present at runtime either way, but leaving
  // it off the interface hides that from the compiler.
  hidden?: boolean;
}

// Two box names carry double quotes - LAB-"Vigilant" Autocannon & MG type and
// its Bombing sibling - and several carry an ampersand. Interpolated raw, the
// quote closed the attribute early and left those two rows' number inputs with
// no accessible name at all. Everything from the data is escaped now, and the
// quote has to be escaped too, not just the three characters text needs.
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function boxCoverUrl(id: number): string {
  return assetUrl(`box_cover/${id}.webp`);
}

export class Inventory {
  private owned: Record<string, number> = {};
  filterEnabled = false;
  private boxes: BoxInfo[];
  private onChange: () => void;
  private cards: Card[];
  private facChoice = '';
  // Which two boxes the compare panel is showing. Kept on the instance so
  // reopening the dialog does not lose the pair.
  private cmp: [string, string] = ['', ''];

  constructor(boxes: BoxInfo[], onChange: () => void, cards: Card[] = []) {
    this.boxes = boxes;
    this.onChange = onChange;
    this.cards = cards;
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      this.owned = raw.owned ?? {};
      this.filterEnabled = !!raw.filterEnabled;
    } catch {
    }
  }

  private save(): void {
    localStorage.setItem(KEY, JSON.stringify({ owned: this.owned, filterEnabled: this.filterEnabled }));
  }

  hasAny(): boolean {
    return Object.values(this.owned).some((n) => n > 0);
  }

  ownedCount(card: Card): number {
    let n = 0;
    // quantityPerBox 0 means the card ships with its parent rather than as a
    // counted copy: Discard Cards sit under their Part Card (4.17), and alternate
    // modes are the same physical card. You still get one with the box, so a 0
    // must not read as "you do not own this".
    for (const c of card.containedIn ?? []) n += (this.owned[c.box] ?? 0) * Math.max(1, c.quantityPerBox);
    return n;
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

  private boxContents(key: string): { id: string; slot: string; name: string; n: number }[] {
    const out: { id: string; slot: string; name: string; n: number }[] = [];
    for (const c of this.cards) {
      const entry = (c.containedIn ?? []).find((e) => e.box === key);
      if (!entry) continue;
      out.push({
        id: c.id,
        slot: SLOT_SHORT[c.type ?? ''] ?? CATEGORY_SHORT[c.category] ?? '',
        name: c.name.en || c.name.zh || c.id,
        n: entry.quantityPerBox,
      });
    }
    const rank = (s: string) => {
      const i = SLOT_ORDER.indexOf(s);
      return i < 0 ? SLOT_ORDER.length : i;
    };
    return out.sort((a, b) => rank(a.slot) - rank(b.slot) || a.name.localeCompare(b.name));
  }

  // Every box a card ships in, so a row can say whether it is unique to the box
  // being looked at or turns up elsewhere too. Cards with no box data at all are
  // excluded from both sides rather than guessed at. Unlisted boxes drop out
  // too: "exclusive" has to mean among boxes somebody can actually buy, or a
  // card whose only other home is the Kickstarter pack reads as shared when in
  // practice this box is the only way to get it.
  private boxesOf(id: string): string[] {
    const c = this.cards.find((x) => x.id === id);
    const listed = new Set(this.sellableBoxes().map((b) => b.key));
    return (c?.containedIn ?? []).map((e) => e.box).filter((b) => listed.has(b));
  }

  private compareRows(key: string, other: string, exclusiveOnly: boolean) {
    return this.boxContents(key)
      .map((i) => {
        const all = this.boxesOf(i.id);
        return { ...i, elsewhere: all.filter((b) => b !== key), inOther: all.includes(other) };
      })
      .filter((i) => !exclusiveOnly || i.elsewhere.length === 0);
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

    const picker = (side: 0 | 1) =>
      `<select class="inv-cmp-pick" data-side="${side}" aria-label="Box ${side + 1}">${pool
        .map((b) => `<option value="${b.key}"${this.cmp[side] === b.key ? ' selected' : ''}>${esc(b.name.en || b.name.zh || b.key)}</option>`)
        .join('')}</select>`;

    const column = (side: 0 | 1) => {
      const key = this.cmp[side];
      const box = pool.find((b) => b.key === key);
      const rows = this.compareRows(key, this.cmp[side ? 0 : 1], exclusiveOnly);
      const all = this.boxContents(key);
      const uniq = all.filter((i) => this.boxesOf(i.id).length === 1).length;
      const sold = box?.released === false ? '<span class="inv-cmp-tag">not currently sold</span>' : '';
      return `<div class="inv-cmp-col">
        <div class="inv-cmp-head">${picker(side)}${sold}</div>
        ${box?.hasImage ? `<div class="inv-cmp-cover"><img src="${boxCoverUrl(box.id)}" alt="" loading="lazy" onerror="this.closest('.inv-cmp-cover').remove()"></div>` : ''}
        <div class="inv-cmp-tally">${all.length} card${all.length === 1 ? '' : 's'} · ${uniq} in no other box · you own ${this.owned[key] ?? 0}</div>
        <ul class="inv-parts inv-cmp-list">${
          rows.length
            ? rows
                .map(
                  (i) =>
                    `<li data-tip-card="${i.id}"${i.inOther ? ' class="shared"' : ''}><span class="ip-slot">${i.slot}</span><span class="ip-name">${esc(i.name)}</span>${
                      i.inOther ? '<span class="ip-both">both</span>' : i.elsewhere.length ? `<span class="ip-else">+${i.elsewhere.length}</span>` : ''
                    }</li>`,
                )
                .join('')
            : '<li class="dim">Nothing to show with this filter.</li>'
        }</ul>
      </div>`;
    };

    const shared = this.boxContents(this.cmp[0]).filter((i) => this.boxesOf(i.id).includes(this.cmp[1])).length;
    panel.innerHTML = `
      <button class="dlg-close inv-compare-close" title="Close">✕</button>
      <div class="inv-contents-head"><b>Compare boxes</b>
        <span class="inv-contents-sub">${shared} card${shared === 1 ? '' : 's'} in both</span></div>
      <label class="inv-filter inv-cmp-filter"><input type="checkbox" id="inv-cmp-excl"${exclusiveOnly ? ' checked' : ''}><span class="inv-tick"></span> Exclusive cards</label>
      <div class="inv-cmp-grid">${column(0)}${column(1)}</div>`;

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
    dlg.innerHTML = `<div class="inv-panel">
      <button id="inv-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head">
        <b>My inventory</b>
        <button id="inv-compare-open" class="inv-cmp-btn">Compare boxes</button>
      </div>
      <p class="dim">Set how many copies of each box you own. Card lists then show your available copy counts.</p>
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
            const n = this.owned[b.key] ?? 0;
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
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#inv-close')!.addEventListener('click', () => dlg.remove());
    dlg.querySelector('#inv-compare-open')!.addEventListener('click', () => this.showCompare(dlg));
    dlg.querySelector<HTMLInputElement>('#inv-filter')!.addEventListener('change', (ev) => {
      this.filterEnabled = (ev.target as HTMLInputElement).checked;
      this.save();
      this.onChange();
    });
    const setCount = (inp: HTMLInputElement, next: number): void => {
      const n = Math.min(9, Math.max(0, next));
      inp.value = String(n);
      if (n === 0) delete this.owned[inp.dataset.box!];
      else this.owned[inp.dataset.box!] = n;
      inp.closest('.inv-box')?.classList.toggle('owned', n > 0);
      this.save();
      this.onChange();
    };
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
