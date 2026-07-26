import type { Card, LangText } from './types';
import { assetUrl } from './data';

const KEY = 'ember-inventory-v1';

export interface BoxInfo {
  key: string;
  id: number;
  name: LangText;
  faction?: string[];
  hasImage?: boolean;
}

function boxCoverUrl(id: number): string {
  return assetUrl(`box_cover/${id}.webp`);
}

export class Inventory {
  private owned: Record<string, number> = {};
  filterEnabled = false;
  private boxes: BoxInfo[];
  private onChange: () => void;

  constructor(boxes: BoxInfo[], onChange: () => void) {
    this.boxes = boxes;
    this.onChange = onChange;
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
    for (const c of card.containedIn ?? []) n += (this.owned[c.box] ?? 0) * c.quantityPerBox;
    return n;
  }

  passes(card: Card): boolean {
    if (!this.filterEnabled || !this.hasAny()) return true;
    return this.ownedCount(card) > 0;
  }

  openDialog(): void {
    document.getElementById('inv-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'inv-dialog';
    dlg.innerHTML = `<div class="inv-panel">
      <button id="inv-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head">
        <b>My inventory</b>
        <label class="inv-filter"><input type="checkbox" id="inv-filter" ${this.filterEnabled ? 'checked' : ''}> Only show what I own</label>
      </div>
      <p class="dim">Set how many copies of each box you own. Card lists then show your available copy counts.</p>
      <div class="inv-list">
        ${this.boxes
          .filter((b) => b.key !== 'UNSALE')
          .map(
            (b) => `<label class="inv-row">
              <input type="number" min="0" max="9" data-box="${b.key}" value="${this.owned[b.key] ?? 0}">
              ${b.hasImage ? `<img class="inv-cover" src="${boxCoverUrl(b.id)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="inv-cover-none"></span>'}
              <span class="inv-name">${b.name.en || b.name.zh || b.key}</span>
              <small>${(b.faction ?? []).join('/')}</small>
            </label>`,
          )
          .join('')}
      </div>
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#inv-close')!.addEventListener('click', () => dlg.remove());
    dlg.querySelector<HTMLInputElement>('#inv-filter')!.addEventListener('change', (ev) => {
      this.filterEnabled = (ev.target as HTMLInputElement).checked;
      this.save();
      this.onChange();
    });
    dlg.querySelectorAll<HTMLInputElement>('input[data-box]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const n = Math.max(0, Number(inp.value) || 0);
        if (n === 0) delete this.owned[inp.dataset.box!];
        else this.owned[inp.dataset.box!] = n;
        this.save();
        this.onChange();
      }),
    );
    document.body.appendChild(dlg);
  }
}
