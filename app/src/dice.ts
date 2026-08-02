import type { DiceData, DiceIcon, DieColor, Side } from './types';
import { assetUrl, squadLabel } from './data';

interface RolledDie {
  color: DieColor;
  face: number;
  selected: boolean;
}

const ICON_LABEL: Record<string, string> = {
  heavyHit: 'Heavy Hit',
  lightHit: 'Light Hit',
  defense: 'Defense',
  dodge: 'Dodge',
  lightning: 'Lightning',
  eye: 'Eye',
};

const PART_SHORT: Record<string, string> = {
  torso: 'TORSO',
  chassis: 'CHAS',
  leftArm: 'L.ARM',
  rightArm: 'R.ARM',
  backpack: 'PACK',
  any: 'ANY',
};

export function iconSvg(icon: DiceIcon, size = 20): string {
  const s = size;
  const fillStyle = icon.hollow ? 'fill="none" stroke="currentColor" stroke-width="1.6"' : 'fill="currentColor"';
  let body = '';
  switch (icon.type) {
    case 'heavyHit': {
      const pts: string[] = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 === 0 ? 9 : 4;
        const a = (i * Math.PI) / 8;
        pts.push(`${10 + r * Math.sin(a)},${10 - r * Math.cos(a)}`);
      }
      body = `<polygon points="${pts.join(' ')}" ${fillStyle}/>`;
      break;
    }
    case 'lightHit':
      body = `<polygon points="10,1.5 14,10 10,18.5 6,10" ${fillStyle}/>`;
      break;
    case 'defense':
      body = `<path d="M10 1.5 L17 4.5 V10 C17 14.5 14 17.5 10 18.8 C6 17.5 3 14.5 3 10 V4.5 Z" ${fillStyle}/>`;
      break;
    case 'dodge':
      body = `<path d="M4 13 A7 7 0 1 1 8 16.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><polygon points="2,10.2 7.2,12 3.4,16" fill="currentColor"/>`;
      break;
    case 'lightning':
      body = `<polygon points="11.5,1 4.5,11 9,11 7.5,19 15.5,8.5 10.7,8.5" ${fillStyle}/>`;
      break;
    case 'eye':
      body = `<path d="M2 10 C5 5 15 5 18 10 C15 15 5 15 2 10 Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="10" r="2.6" ${icon.hollow ? 'fill="none" stroke="currentColor" stroke-width="1.5"' : 'fill="currentColor"'}/>`;
      break;
    case 'part': {
      const part = icon.part ?? 'any';
      return `<img class="part-icon" src="${assetUrl(`dice/black_${part}.webp`)}" alt="${PART_SHORT[part] ?? part}" title="${PART_SHORT[part] ?? part}">`;
    }
    default:
      return '';
  }
  return `<svg viewBox="0 0 20 20" width="${s}" height="${s}" aria-hidden="true">${body}</svg>`;
}

export class DiceTray {
  private dice: DiceData;
  private root: HTMLElement;
  private pool: Partial<Record<DieColor, number>> = {};
  private rolled: RolledDie[] = [];
  private rerollUsed: Record<Side, boolean> = { s1: false, s2: false };
  private animTimer: number | undefined;

  constructor(dice: DiceData, root: HTMLElement) {
    this.dice = dice;
    this.root = root;
    this.render();
  }

  addToPool(add: Partial<Record<DieColor, number>>, replace = false): void {
    if (replace) this.pool = {};
    for (const [color, n] of Object.entries(add) as [DieColor, number][]) {
      if (!n) continue;
      this.pool[color] = (this.pool[color] ?? 0) + n;
    }
    this.render();
  }

  roll(): void {
    this.rolled = [];
    for (const [color, n] of Object.entries(this.pool) as [DieColor, number][]) {
      for (let i = 0; i < (n ?? 0); i++) {
        this.rolled.push({ color, face: this.randomFace(color), selected: false });
      }
    }
    this.rerollUsed = { s1: false, s2: false };
    this.animate();
  }

  private randomFace(color: DieColor): number {
    return Math.floor(Math.random() * this.dice.dice[color].sides);
  }

  private animate(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    let ticks = 0;
    this.root.classList.add('rolling');
    this.animTimer = window.setInterval(() => {
      ticks++;
      for (const d of this.rolled) {
        if (ticks < 8) d.face = this.randomFace(d.color);
      }
      this.render();
      if (ticks >= 8) {
        clearInterval(this.animTimer);
        this.root.classList.remove('rolling');
      }
    }, 55);
  }

  showGroups(groups: { label: string; roll: { color: DieColor; face: number }[] }[]): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.root.classList.remove('rolling');
    this.pool = {};
    this.rolled = [];
    const section = (g: { label: string; roll: { color: DieColor; face: number }[] }) => {
      const dice = g.roll
        .map((d) => {
          const face = this.dice.dice[d.color].faces[d.face];
          const icons = face.length ? face.map((ic) => iconSvg(ic)).join('') : '<span class="blank">·</span>';
          return `<span class="die die-${d.color}">${icons}</span>`;
        })
        .join('');
      const counts = new Map<string, number>();
      for (const d of g.roll) {
        for (const icon of this.dice.dice[d.color].faces[d.face]) {
          const key = icon.type === 'part' ? `→ ${PART_SHORT[icon.part ?? 'any']}` : `${icon.hollow ? 'hollow ' : ''}${ICON_LABEL[icon.type] ?? icon.type}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const totals = [...counts.entries()].map(([k, v]) => `<span class="total-chip">${v}× ${k}</span>`).join('');
      return `<div class="tray-group">
        <div class="tray-group-head">${g.label}</div>
        <div class="tray-results">${dice}</div>
        ${totals ? `<div class="totals">${totals}</div>` : ''}
      </div>`;
    };
    this.root.innerHTML = `<div class="tray-versus">${groups.map(section).join('<div class="tray-vs">vs</div>')}</div>`;
  }

  showFixed(dice: { color: DieColor; face: number }[], animate = true): void {
    this.pool = {};
    for (const d of dice) this.pool[d.color] = (this.pool[d.color] ?? 0) + 1;
    this.rolled = dice.map((d) => ({ color: d.color, face: d.face, selected: false }));
    this.rerollUsed = { s1: true, s2: true };
    if (!animate) {
      this.render();
      return;
    }
    const want = this.rolled.map((d) => d.face);
    if (this.animTimer) clearInterval(this.animTimer);
    let ticks = 0;
    this.root.classList.add('rolling');
    this.animTimer = window.setInterval(() => {
      ticks++;
      this.rolled.forEach((d, i) => {
        d.face = ticks < 6 ? this.randomFace(d.color) : want[i];
      });
      this.render();
      if (ticks >= 6) {
        clearInterval(this.animTimer);
        this.root.classList.remove('rolling');
      }
    }, 55);
  }

  clear(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.root.classList.remove('rolling');
    this.pool = {};
    this.rolled = [];
    this.render();
  }

  private rerollSelected(player: Side): void {
    if (this.rerollUsed[player]) return;
    const sel = this.rolled.filter((d) => d.selected);
    if (!sel.length) return;
    this.rerollUsed[player] = true;
    for (const d of sel) {
      d.face = this.randomFace(d.color);
      d.selected = false;
    }
    this.animate();
  }

  private totals(): string[] {
    const counts = new Map<string, number>();
    for (const d of this.rolled) {
      for (const icon of this.dice.dice[d.color].faces[d.face]) {
        if (icon.type === 'part') {
          counts.set(`→ ${PART_SHORT[icon.part ?? 'any']}`, (counts.get(`→ ${PART_SHORT[icon.part ?? 'any']}`) ?? 0) + 1);
        } else {
          const key = `${icon.hollow ? 'hollow ' : ''}${ICON_LABEL[icon.type] ?? icon.type}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].map(([k, v]) => `${v}× ${k}`);
  }

  private render(): void {
    const POOL_LABEL: Record<DieColor, string> = {
      red: 'Heavy Hit',
      yellow: 'Light Hit',
      white: 'Defense',
      blue: 'Dodge',
      black: 'Part',
    };
    const poolBtns = (['red', 'yellow', 'white', 'blue', 'black'] as DieColor[])
      .map((c) => {
        const n = this.pool[c] ?? 0;
        return `<div class="pool-die die-${c}${n ? ' has' : ''}" data-color="${c}" title="${this.dice.dice[c].role}">
          <span class="pool-name">${POOL_LABEL[c]}</span>
          <button class="minus" data-color="${c}">−</button><b>${n}</b><button class="plus" data-color="${c}">+</button>
        </div>`;
      })
      .join('');

    const diceHtml = this.rolled
      .map((d, i) => {
        const face = this.dice.dice[d.color].faces[d.face];
        const icons = face.length ? face.map((ic) => iconSvg(ic)).join('') : '<span class="blank">·</span>';
        return `<button class="die die-${d.color}${d.selected ? ' sel' : ''}" data-i="${i}" title="click to mark for reroll">${icons}</button>`;
      })
      .join('');

    const totals = this.rolled.length ? this.totals().map((t) => `<span class="total-chip">${t}</span>`).join('') : '';

    const poolTotal = Object.values(this.pool).reduce((s, n) => s + (n ?? 0), 0);
    this.root.innerHTML = `
      <div class="tray-pool">${poolBtns}</div>
      <div class="tray-actions">
        <button id="dice-roll" class="primary" ${poolTotal ? '' : 'disabled'}>Roll ${poolTotal ? `${poolTotal} dice` : ''}</button>
        <button id="dice-clear" title="Empty the pool and results">Clear</button>
      </div>
      <div class="tray-results">${diceHtml || '<span class="tray-empty">No dice rolled yet.</span>'}</div>
      ${totals ? `<div class="totals">${totals}</div>` : ''}
      ${
        this.rolled.length
          ? `<div class="rerolls">
              <button id="rr-s1" ${this.rerollUsed.s1 ? 'disabled' : ''}>${squadLabel('s1')} reroll</button>
              <button id="rr-s2" ${this.rerollUsed.s2 ? 'disabled' : ''}>${squadLabel('s2')} reroll</button>
             </div>
             <p class="tray-hint">Select dice above, then reroll (once per player).</p>`
          : ''
      }`;

    this.root.querySelectorAll<HTMLButtonElement>('.plus').forEach((b) =>
      b.addEventListener('click', () => this.addToPool({ [b.dataset.color as DieColor]: 1 })),
    );
    this.root.querySelectorAll<HTMLButtonElement>('.minus').forEach((b) =>
      b.addEventListener('click', () => {
        const c = b.dataset.color as DieColor;
        this.pool[c] = Math.max(0, (this.pool[c] ?? 0) - 1);
        this.render();
      }),
    );
    this.root.querySelector('#dice-roll')?.addEventListener('click', () => this.roll());
    this.root.querySelector('#dice-clear')?.addEventListener('click', () => {
      this.pool = {};
      this.rolled = [];
      this.render();
    });
    this.root.querySelectorAll<HTMLButtonElement>('.die').forEach((b) =>
      b.addEventListener('click', () => {
        const d = this.rolled[Number(b.dataset.i)];
        d.selected = !d.selected;
        this.render();
      }),
    );
    this.root.querySelector('#rr-s1')?.addEventListener('click', () => this.rerollSelected('s1'));
    this.root.querySelector('#rr-s2')?.addEventListener('click', () => this.rerollSelected('s2'));
  }
}
