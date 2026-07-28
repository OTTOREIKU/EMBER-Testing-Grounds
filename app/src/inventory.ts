import type { Card, LangText } from './types';
import { assetUrl } from './data';

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
}

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
    return this.boxes.filter((b) => b.key !== 'UNSALE');
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

  private showContents(dlg: HTMLElement, key: string): void {
    dlg.querySelector('.inv-contents')?.remove();
    const box = this.boxes.find((b) => b.key === key);
    const items = this.boxContents(key);
    const panel = document.createElement('div');
    panel.className = 'inv-contents';
    const total = items.reduce((s, i) => s + i.n, 0);
    panel.innerHTML = `
      <button class="dlg-close inv-contents-close" title="Close">✕</button>
      <div class="inv-contents-head">
        <div>
          <b>${box?.name.en || box?.name.zh || key}</b>
          <span class="inv-contents-sub">${items.length} card${items.length === 1 ? '' : 's'} · ${total} piece${total === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${
        items.length
          ? `<ul class="inv-parts">${items
              .map(
                (i) =>
                  `<li data-tip-card="${i.id}"><span class="ip-slot">${i.slot}</span><span class="ip-name">${i.name}</span>${i.n > 1 ? `<span class="ip-n">×${i.n}</span>` : ''}</li>`,
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

  openDialog(): void {
    document.getElementById('inv-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'inv-dialog';
    dlg.innerHTML = `<div class="inv-panel">
      <button id="inv-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head">
        <b>My inventory</b>
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
                <div class="inv-name">${b.name.en || b.name.zh || b.key}</div>
                <div class="inv-count">
                  <button class="inv-step" data-step="-1" data-box="${b.key}" title="One fewer">−</button>
                  <input type="number" min="0" max="9" data-box="${b.key}" value="${n}" aria-label="${b.name.en || b.key} copies owned">
                  <button class="inv-step" data-step="1" data-box="${b.key}" title="One more">+</button>
                  <button class="inv-info" data-info="${b.key}" title="What is in this box" aria-label="Contents of ${b.name.en || b.key}">i</button>
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
