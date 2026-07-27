import type { GameState, Marker, TerrainPiece, Token } from './types';
import { statusCount, statusStacks } from './types';
import { mechPartUrl, SIDE_LABEL, tabImageUrl } from './data';
import type { InspectInfo } from './inspector';

export const MECH_LAYER_ORDER = ['chasis', 'backpack', 'torso', 'leftHand', 'rightHand'] as const;

export const CELL = 30;
export const CELLS = 36;
const SIZE = CELL * CELLS;
const M = 26;

const TERRAIN_FILL: Record<TerrainPiece['type'], string> = {
  building: '#4b5563',
  high_wall: '#6b7280',
  low_wall: '#d1d5db',
  container: '#2fae6e',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BoardZone {
  name: string;
  cells: { col: number; row: number }[];
}

export interface DeployShape {
  rect?: { col: number; row: number; cols: number; rows: number };
  cells?: { col: number; row: number }[];
  label?: string;
}

export interface BoardDeployment {
  black?: DeployShape;
  white?: DeployShape;
}

export interface BoardCallbacks {
  onSelect(uid: number | null): void;
  onInspect?(info: InspectInfo | null): void;
  onMove(uid: number, col: number, row: number): void;
  onHover?(uid: number | null): void;
  onCellClick?(col: number, row: number, erase: boolean): void;
  onCellHover?(col: number, row: number): void;
  onTerrainClick?(id: string, erase: boolean): void;
  onDestroyTerrain?(id: string): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function outlinePath(cells: { col: number; row: number }[], size: number): string {
  const filled = new Set(cells.map((c) => `${c.col},${c.row}`));
  const has = (col: number, row: number) => filled.has(`${col},${row}`);
  const runs = (lines: Map<number, number[]>): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (const [fixed, raw] of lines) {
      const sorted = [...raw].sort((a, b) => a - b);
      let start = sorted[0];
      let end = start + 1;
      for (const v of sorted.slice(1)) {
        if (v === end) {
          end = v + 1;
          continue;
        }
        out.push([fixed, start, end]);
        start = v;
        end = v + 1;
      }
      out.push([fixed, start, end]);
    }
    return out;
  };
  const horizontal = new Map<number, number[]>();
  const vertical = new Map<number, number[]>();
  const push = (map: Map<number, number[]>, key: number, v: number) => {
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  };
  for (const c of cells) {
    if (!has(c.col, c.row - 1)) push(horizontal, c.row, c.col);
    if (!has(c.col, c.row + 1)) push(horizontal, c.row + 1, c.col);
    if (!has(c.col - 1, c.row)) push(vertical, c.col, c.row);
    if (!has(c.col + 1, c.row)) push(vertical, c.col + 1, c.row);
  }
  const parts: string[] = [];
  for (const [y, x0, x1] of runs(horizontal)) parts.push(`M${x0 * size} ${y * size}H${x1 * size}`);
  for (const [x, y0, y1] of runs(vertical)) parts.push(`M${x * size} ${y0 * size}V${y1 * size}`);
  return parts.join('');
}

export class Board {
  svg: SVGSVGElement;
  private gZones!: SVGGElement;
  private gTerrain: SVGGElement;
  private gTokens: SVGGElement;
  private gOverlay: SVGGElement;
  private gHighlight: SVGGElement;
  private gMarkers!: SVGGElement;
  private gGhost: SVGGElement;
  private callbacks: BoardCallbacks;
  private selectedUid: number | null = null;
  private lastHover: { col: number; row: number } | null = null;
  private container!: HTMLElement;
  private scrollWrap!: HTMLElement;
  private zoom = 1;
  private fitBase = 0;
  private resizeObserver!: ResizeObserver;
  panEnabled = true;
  editing = false;

  private cellAt(ev: PointerEvent): { col: number; row: number } | null {
    const pt = this.svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM()!.inverse());
    const col = Math.floor(p.x / CELL);
    const row = Math.floor(p.y / CELL);
    if (col < 0 || row < 0 || col >= CELLS || row >= CELLS) return null;
    return { col, row };
  }

  constructor(container: HTMLElement, callbacks: BoardCallbacks) {
    this.callbacks = callbacks;
    this.svg = el('svg', {
      viewBox: `${-M} ${-M} ${SIZE + 2 * M} ${SIZE + 2 * M}`,
      id: 'board',
    });
    this.svg.appendChild(this.buildGrid());
    this.gZones = el('g', { class: 'zones', 'pointer-events': 'none' });
    this.svg.appendChild(this.gZones);
    this.gTerrain = el('g');
    this.gMarkers = el('g', { class: 'markers' });
    this.gHighlight = el('g', { class: 'highlight', 'pointer-events': 'none' });
    this.gTokens = el('g');
    this.gGhost = el('g', { class: 'ghost', 'pointer-events': 'none' });
    this.gOverlay = el('g', { class: 'overlay', 'pointer-events': 'none' });
    this.svg.appendChild(this.gTerrain);
    this.svg.appendChild(this.gMarkers);
    this.svg.appendChild(this.gHighlight);
    this.svg.appendChild(this.gTokens);
    this.svg.appendChild(this.gGhost);
    this.svg.appendChild(this.gOverlay);
    let pan: { x: number; y: number; l: number; t: number; moved: boolean } | null = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      const bg = !(ev.target as Element).closest?.('.token');
      if (!bg) return;
      if (this.panEnabled) {
        if (ev.button !== 0) return;
        pan = { x: ev.clientX, y: ev.clientY, l: this.scrollWrap.scrollLeft, t: this.scrollWrap.scrollTop, moved: false };
      } else {
        if (ev.button !== 0 && ev.button !== 2) return;
        const cell = this.cellAt(ev);
        if (cell && this.callbacks.onCellClick) this.callbacks.onCellClick(cell.col, cell.row, ev.button === 2);
        if (ev.button === 0) this.callbacks.onSelect(null);
      }
    });
    this.svg.addEventListener('contextmenu', (ev) => {
      if (this.editing) ev.preventDefault();
    });
    window.addEventListener('pointermove', (ev) => {
      if (!pan) return;
      const dx = ev.clientX - pan.x;
      const dy = ev.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      this.scrollWrap.scrollLeft = pan.l - dx;
      this.scrollWrap.scrollTop = pan.t - dy;
    });
    window.addEventListener('pointerup', () => {
      if (!pan) return;
      const wasClick = !pan.moved;
      pan = null;
      if (wasClick) this.callbacks.onSelect(null);
    });
    this.svg.addEventListener('pointermove', (ev) => {
      if (!this.callbacks.onCellHover) return;
      const cell = this.cellAt(ev);
      if (cell && (cell.col !== this.lastHover?.col || cell.row !== this.lastHover?.row)) {
        this.lastHover = cell;
        this.callbacks.onCellHover(cell.col, cell.row);
      }
    });
    this.container = container;
    this.scrollWrap = document.createElement('div');
    this.scrollWrap.className = 'board-scroll';
    this.scrollWrap.appendChild(this.svg);
    container.appendChild(this.scrollWrap);

    container.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.setZoom(this.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
      },
      { passive: false },
    );
    const zc = document.createElement('div');
    zc.className = 'zoom-ctrl';
    zc.innerHTML = `<button data-z="out" title="Zoom out">−</button><button data-z="reset" title="Reset zoom">⤢</button><button data-z="in" title="Zoom in">+</button>`;
    zc.querySelector('[data-z="out"]')!.addEventListener('click', () => this.setZoom(this.zoom / 1.2));
    zc.querySelector('[data-z="in"]')!.addEventListener('click', () => this.setZoom(this.zoom * 1.2));
    zc.querySelector('[data-z="reset"]')!.addEventListener('click', () => this.setZoom(1));
    container.appendChild(zc);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.applyZoom());
      this.resizeObserver.observe(container);
    }
    window.addEventListener('resize', () => this.applyZoom());
    this.refit();
  }

  refit(): void {
    this.applyZoom();
    requestAnimationFrame(() => this.applyZoom());
    setTimeout(() => this.applyZoom(), 60);
  }

  private applyZoom(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    this.fitBase = Math.max(200, Math.min(w, h) - 18);
    const sz = this.fitBase * this.zoom;
    this.svg.style.width = `${sz}px`;
    this.svg.style.height = `${sz}px`;
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.6, Math.min(3.5, z));
    this.applyZoom();
  }

  private buildGrid(): SVGGElement {
    const g = el('g', { id: 'grid' });
    const bg = el('rect', { x: 0, y: 0, width: SIZE, height: SIZE, fill: '#f4f1ea' });
    g.appendChild(bg);
    for (let i = 0; i <= CELLS; i++) {
      const large = i % 3 === 0;
      const p = i * CELL;
      g.appendChild(el('line', { x1: p, y1: 0, x2: p, y2: SIZE, stroke: large ? '#8a8577' : '#d8d2c4', 'stroke-width': large ? 1.6 : 0.6 }));
      g.appendChild(el('line', { x1: 0, y1: p, x2: SIZE, y2: p, stroke: large ? '#8a8577' : '#d8d2c4', 'stroke-width': large ? 1.6 : 0.6 }));
    }
    for (let i = 0; i < 12; i++) {
      const c = i * 3 * CELL + 1.5 * CELL;
      const col = el('text', { x: c, y: -8, 'text-anchor': 'middle', class: 'grid-label' });
      col.textContent = String.fromCharCode(65 + i);
      const row = el('text', { x: -10, y: c + 4, 'text-anchor': 'middle', class: 'grid-label' });
      row.textContent = String(i + 1);
      g.appendChild(col);
      g.appendChild(row);
    }
    const border = el('rect', { x: 0, y: 0, width: SIZE, height: SIZE, fill: 'none', stroke: '#57534e', 'stroke-width': 2.5 });
    g.appendChild(border);
    return g;
  }

  private attachInspect(g: SVGGElement, info: InspectInfo): void {
    g.addEventListener('pointerenter', () => this.callbacks.onInspect?.(info));
    g.addEventListener('pointerleave', () => this.callbacks.onInspect?.(null));
  }

  renderTerrain(pieces: TerrainPiece[], editable = false): void {
    this.gTerrain.replaceChildren();
    for (const p of pieces) {
      const cls = `terrain terrain-${p.type}${editable ? ' editable' : ''}${p.isFragile ? ' destructible' : ''}`;
      const g = el('g', { class: cls });
      const cols = p.subCells.map((c) => c.col);
      const rows = p.subCells.map((c) => c.row);
      const x0 = Math.min(...cols);
      const y0 = Math.min(...rows);
      const w = (Math.max(...cols) - x0 + 1) * CELL;
      const h = (Math.max(...rows) - y0 + 1) * CELL;
      const block = el('rect', {
        x: x0 * CELL + 1.5,
        y: y0 * CELL + 1.5,
        width: w - 3,
        height: h - 3,
        rx: p.type === 'container' ? 3 : 2,
        fill: TERRAIN_FILL[p.type],
        stroke: p.blocksLos ? '#111827' : '#0006',
        'stroke-width': p.blocksLos ? 1.5 : 1,
        opacity: 0.95,
      });
      g.appendChild(block);
      const badge = el('text', { x: x0 * CELL + w / 2, y: y0 * CELL + h / 2 + 4, 'text-anchor': 'middle', class: 'terrain-badge' });
      badge.textContent = `${p.height}"`;
      g.appendChild(badge);
      if (p.isFragile) {
        const dm = el('text', { x: x0 * CELL + w - 5, y: y0 * CELL + 11, 'text-anchor': 'end', class: 'terrain-fragile' });
        dm.textContent = '✸';
        g.appendChild(dm);
      }
      const TERRAIN_NAME: Record<TerrainPiece['type'], string> = {
        building: 'Building',
        high_wall: 'Defense Wall (tall)',
        low_wall: 'Defense Wall (short)',
        container: 'Container',
      };
      this.attachInspect(g, {
        title: TERRAIN_NAME[p.type],
        sub: `${p.height}" high`,
        lines: [
          p.blocksLos ? 'Blocks line of sight' : 'Does not block line of sight',
          p.providesProtection ? 'Gives Terrain Protection (+2 White when fired through)' : 'No protection dice',
          p.isFragile ? 'Destructible — click to destroy; a Large unit moving in Crushes it' : 'Cannot be destroyed',
        ],
      });
      if (editable) {
        g.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0 && ev.button !== 2) return;
          ev.stopPropagation();
          this.callbacks.onTerrainClick?.(p.id, ev.button === 2);
        });
      } else if (p.isFragile) {
        g.style.cursor = 'pointer';
        g.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          this.callbacks.onDestroyTerrain?.(p.id);
        });
      }
      this.gTerrain.appendChild(g);
    }
  }

  renderZones(zones: BoardZone[], deploy: BoardDeployment | null): void {
    this.gZones.replaceChildren();
    const LG = 3 * CELL;

    if (deploy) {
      for (const side of ['black', 'white'] as const) {
        const shape = deploy[side];
        if (!shape) continue;
        const g = el('g', { class: `dz dz-${side}` });
        let lx = 0;
        let ly = 0;
        if (shape.rect) {
          const r = shape.rect;
          g.appendChild(el('rect', { x: r.col * LG, y: r.row * LG, width: r.cols * LG, height: r.rows * LG, rx: 4, class: 'zone-fill' }));
          g.appendChild(el('rect', { x: r.col * LG, y: r.row * LG, width: r.cols * LG, height: r.rows * LG, rx: 4, class: 'zone-edge' }));
          lx = r.col * LG + (r.cols * LG) / 2;
          ly = r.row * LG + (r.rows * LG) / 2 + 6;
        } else if (shape.cells?.length) {
          for (const c of shape.cells) {
            g.appendChild(el('rect', { x: c.col * LG, y: c.row * LG, width: LG, height: LG, class: 'zone-fill' }));
          }
          g.appendChild(el('path', { d: outlinePath(shape.cells, LG), class: 'zone-edge' }));
          const top = [...shape.cells].sort((a, b) => a.row - b.row || a.col - b.col)[0];
          lx = top.col * LG + LG / 2;
          ly = top.row * LG + LG / 2 + 6;
        } else {
          continue;
        }
        const label = el('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'dz-label' });
        label.textContent = shape.label ?? (side === 'black' ? 'BLACK' : 'WHITE');
        g.appendChild(label);
        this.gZones.appendChild(g);
      }
    }

    for (const z of zones) {
      const g = el('g', { class: 'tz' });
      for (const c of z.cells) {
        g.appendChild(el('rect', { x: c.col * LG, y: c.row * LG, width: LG, height: LG, class: 'zone-fill' }));
      }
      if (z.cells.length) g.appendChild(el('path', { d: outlinePath(z.cells, LG), class: 'zone-edge' }));
      const first = z.cells[0];
      if (first) {
        const label = el('text', {
          x: first.col * LG + LG / 2,
          y: first.row * LG + LG / 2 + 5,
          'text-anchor': 'middle',
          class: 'tz-label',
        });
        label.textContent = z.name;
        g.appendChild(label);
      }
      this.gZones.appendChild(g);
    }
  }

  renderMarkers(markers: Marker[]): void {
    this.gMarkers.replaceChildren();
    for (const m of markers) {
      const cx = m.col * 3 * CELL + 1.5 * CELL;
      const cy = m.row * 3 * CELL + 1.5 * CELL;
      const g = el('g', { class: `marker marker-${m.kind}` });
      g.appendChild(el('circle', { cx, cy, r: 12 }));
      const icon = el('text', { x: cx, y: cy + 4.5, 'text-anchor': 'middle', class: 'marker-icon' });
      icon.textContent = m.kind.charAt(0).toUpperCase();
      g.appendChild(icon);
      const label = el('text', { x: cx, y: cy + 24, 'text-anchor': 'middle', class: 'marker-label' });
      label.textContent = m.kind;
      g.appendChild(label);
      this.attachInspect(g, {
        title: `${m.kind.charAt(0).toUpperCase()}${m.kind.slice(1)} marker`,
        sub: `Grid ${String.fromCharCode(65 + m.col)}${m.row + 1}`,
        lines: ['Scenario objective — see the scenario briefing for how it scores.'],
      });
      this.gMarkers.appendChild(g);
    }
  }

  renderTokens(state: GameState): void {
    this.gTokens.replaceChildren();
    for (const t of state.tokens) this.gTokens.appendChild(this.buildToken(t));
    this.applySelection();
  }

  setSelected(uid: number | null): void {
    this.selectedUid = uid;
    this.applySelection();
  }

  private applySelection(): void {
    for (const n of this.gTokens.querySelectorAll<SVGGElement>('.token')) {
      n.classList.toggle('selected', Number(n.dataset.uid) === this.selectedUid);
    }
  }

  private buildToken(t: Token): SVGGElement {
    const footPx = t.size * CELL;
    const visPx = Math.max(footPx, 54);
    const cx = footPx / 2;
    const cy = footPx / 2;
    const half = visPx / 2;
    const wrecked = t.kind === 'mech' ? t.partStates.torso === 'destroyed' : t.partStates.main === 'destroyed';
    const shutdown = !wrecked && t.stance === 'shutdown';
    const camo = !wrecked && statusCount(t.statuses, 'camouflage') > 0;
    const g = el('g', {
      class: `token side-${t.side}${t.aerial ? ' aerial' : ''} kind-${t.kind}${wrecked ? ' wrecked' : ''}${shutdown ? ' shutdown' : ''}${camo ? ' camo' : ''}`,
    });
    g.dataset.uid = String(t.uid);
    g.setAttribute('transform', `translate(${t.col * CELL}, ${t.row * CELL})`);

    const base = el('rect', {
      x: cx - half + 1.5,
      y: cy - half + 1.5,
      width: visPx - 3,
      height: visPx - 3,
      rx: t.aerial ? visPx / 2 : 5,
      class: 'token-base',
    });
    g.appendChild(base);

    const inset = visPx * 0.06;
    const artX = cx - half + inset;
    const artY = cy - half + inset;
    const artSz = visPx - 2 * inset;
    const addLayer = (href: string) => {
      const img = el('image', { x: artX, y: artY, width: artSz, height: artSz, class: 'token-art' });
      img.setAttribute('href', href);
      img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      img.addEventListener('error', () => img.remove(), { once: true });
      g.appendChild(img);
    };
    if (t.kind === 'mech' && t.mech) {
      let any = false;
      for (const slot of MECH_LAYER_ORDER) {
        const id = t.mech[slot];
        if (!id) continue;
        if (t.partStates[slot] === 'destroyed' && slot !== 'torso' && slot !== 'chasis') continue;
        addLayer(mechPartUrl(id));
        any = true;
      }
      if (!any) addLayer(tabImageUrl(t.cardId));
    } else {
      addLayer(tabImageUrl(t.cardId));
    }

    if (camo) {
      for (let i = 1; i <= 3; i++) {
        const y = cy - half + (visPx * i) / 4;
        g.appendChild(el('line', { x1: cx - half + 5, y1: y, x2: cx + half - 5, y2: y, class: 'token-ghost' }));
      }
      const mark = el('text', { x: cx, y: cy + half - 6, 'font-size': 9, class: 'token-ghost-text' });
      mark.textContent = 'CAMO';
      g.appendChild(mark);
    }

    const tip = cy - half - 3;
    const arrow = el('path', {
      d: `M ${cx} ${tip} L ${cx + 10} ${tip + 14} L ${cx - 10} ${tip + 14} Z`,
      class: 'token-facing',
      transform: `rotate(${t.facing * 90} ${cx} ${cy})`,
    });
    g.appendChild(arrow);

    if (wrecked || shutdown) {
      const tag = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: `token-status ${wrecked ? 'is-wrecked' : 'is-shutdown'}` });
      tag.textContent = wrecked ? 'DESTROYED' : 'SHUTDOWN';
      g.appendChild(tag);
    }

    const label = el('text', { x: cx, y: cy + half + 9, 'text-anchor': 'middle', class: 'token-label' });
    label.textContent = t.label;
    g.appendChild(label);

    const active = statusStacks(t.statuses);
    if (active.length) {
      const bw = 19;
      const startX = cx - (active.length * bw) / 2 + bw / 2;
      active.forEach(({ def: s, n }, i) => {
        const stacked = !!s.stacking && n > 1;
        const bx = startX + i * bw;
        const by = cy - half - 9;
        const badge = el('g', { class: 'status-badge' });
        const w = stacked ? 22 : 17;
        badge.appendChild(el('rect', { x: bx - w / 2, y: by - 6.5, width: w, height: 13, rx: 3, fill: s.tint, stroke: '#0f1216', 'stroke-width': 1 }));
        const txt = el('text', { x: bx, y: by + 3.5, 'text-anchor': 'middle', class: 'status-badge-text' });
        txt.textContent = stacked ? `${s.icon}${n}` : s.icon;
        badge.appendChild(txt);
        this.attachInspect(badge as SVGGElement, {
          title: stacked ? `${s.label} ×${n}` : s.label,
          sub: `${s.icon} · on ${t.label}`,
          lines: [s.note, 'Toggle this token from the unit’s row in the Squads tab.'],
        });
        g.appendChild(badge);
      });
    }

    const parts = Object.entries(t.partStates);
    const gone = parts.filter(([, s]) => s === 'destroyed').length;
    const hurt = parts.filter(([, s]) => s === 'damaged').length;
    this.attachInspect(g, {
      title: t.label,
      sub: `${SIDE_LABEL[t.side]} · ${t.kind}`,
      lines: [
        `Stance ${t.stance.toUpperCase()}${t.link !== undefined ? ` · Link ⚡${t.link}` : ''}`,
        `Facing ${['North', 'East', 'South', 'West'][t.facing]}`,
        wrecked ? 'DESTROYED' : hurt || gone ? `${hurt} damaged, ${gone} destroyed part(s)` : 'All parts intact',
      ],
    });

    g.addEventListener('pointerenter', () => this.callbacks.onHover?.(t.uid));
    g.addEventListener('pointerleave', () => this.callbacks.onHover?.(null));

    this.attachDrag(g, t);
    return g;
  }

  showReachable(grids: { c: number; r: number; dist: number }[], maxDist: number): void {
    this.clearHighlights();
    const g = el('g', { class: 'reach-overlay', 'pointer-events': 'none' });
    for (const cell of grids) {
      const rect = el('rect', {
        x: cell.c * 3 * CELL + 2,
        y: cell.r * 3 * CELL + 2,
        width: 3 * CELL - 4,
        height: 3 * CELL - 4,
        rx: 4,
        class: 'reach-cell',
        opacity: 0.55 - (cell.dist / Math.max(1, maxDist)) * 0.3,
      });
      g.appendChild(rect);
      const label = el('text', { x: cell.c * 3 * CELL + 8, y: cell.r * 3 * CELL + 16, class: 'reach-dist' });
      label.textContent = String(cell.dist);
      g.appendChild(label);
    }
    this.gHighlight.appendChild(g);
  }

  showRangeRings(from: { col: number; row: number; size: number }, range: number, cls = 'range-ring'): void {
    this.clearHighlights();
    const g = el('g', { class: 'range-overlay', 'pointer-events': 'none' });
    const gc = Math.floor(from.col / 3);
    const gr = Math.floor(from.row / 3);
    const cells = Math.ceil(CELLS / 3);
    for (let c = 0; c < cells; c++) {
      for (let r = 0; r < cells; r++) {
        const d = Math.abs(c - gc) + Math.abs(r - gr);
        if (d > range) continue;
        const self = d === 0;
        const rect = el('rect', {
          x: c * 3 * CELL + 2,
          y: r * 3 * CELL + 2,
          width: 3 * CELL - 4,
          height: 3 * CELL - 4,
          rx: 4,
          class: self ? `${cls} range-ring-self` : cls,
          opacity: self ? 0.3 : 0.42 - (d / Math.max(1, range)) * 0.24,
        });
        g.appendChild(rect);
        if (!self) {
          const label = el('text', { x: c * 3 * CELL + 8, y: r * 3 * CELL + 16, class: 'range-ring-dist' });
          label.textContent = String(d);
          g.appendChild(label);
        }
      }
    }
    this.gHighlight.appendChild(g);
  }

  showArcs(t: { col: number; row: number; size: number; facing: number }): void {
    this.clearHighlights();
    const cx = (t.col + t.size / 2) * CELL;
    const cy = (t.row + t.size / 2) * CELL;
    const R = SIZE * 1.6;
    const mk = (rotDeg: number, cls: string) => {
      const p = el('path', {
        d: `M ${cx} ${cy} L ${cx - R} ${cy - R} L ${cx + R} ${cy - R} Z`,
        class: cls,
        transform: `rotate(${rotDeg} ${cx} ${cy})`,
      });
      return p;
    };
    const g = el('g', { class: 'arc-overlay', 'pointer-events': 'none' });
    const clipId = 'board-clip';
    if (!this.svg.querySelector(`#${clipId}`)) {
      const clip = el('clipPath', { id: clipId });
      clip.appendChild(el('rect', { x: 0, y: 0, width: SIZE, height: SIZE }));
      this.svg.appendChild(clip);
    }
    g.setAttribute('clip-path', `url(#${clipId})`);
    g.appendChild(mk(t.facing * 90, 'arc-forward'));
    g.appendChild(mk(t.facing * 90 + 180, 'arc-rear'));
    this.gHighlight.appendChild(g);
  }

  clearHighlights(): void {
    this.gHighlight.replaceChildren();
  }

  showGhost(cells: { col: number; row: number }[], ok: boolean): void {
    this.gGhost.replaceChildren();
    for (const c of cells) {
      this.gGhost.appendChild(
        el('rect', {
          x: c.col * CELL + 1,
          y: c.row * CELL + 1,
          width: CELL - 2,
          height: CELL - 2,
          rx: 2,
          class: ok ? 'ghost-ok' : 'ghost-bad',
        }),
      );
    }
  }

  clearGhost(): void {
    this.gGhost.replaceChildren();
  }

  showRange(a: { col: number; row: number; size: number }, b: { col: number; row: number; size: number }, text: string): void {
    this.gOverlay.replaceChildren();
    const ax = (a.col + a.size / 2) * CELL;
    const ay = (a.row + a.size / 2) * CELL;
    const bx = (b.col + b.size / 2) * CELL;
    const by = (b.row + b.size / 2) * CELL;
    this.gOverlay.appendChild(el('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'range-line' }));
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const label = el('text', { x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'range-label' });
    label.textContent = text;
    this.gOverlay.appendChild(label);
    const box = label.getBBox();
    const padX = 10;
    const padY = 5;
    const bg = el('rect', {
      x: box.x - padX,
      y: box.y - padY,
      width: box.width + padX * 2,
      height: box.height + padY * 2,
      rx: 7,
      class: 'range-bg',
    });
    this.gOverlay.insertBefore(bg, label);
  }

  clearRange(): void {
    this.gOverlay.replaceChildren();
  }

  private attachDrag(g: SVGGElement, t: Token): void {
    let start: { x: number; y: number } | null = null;
    let orig = { col: t.col, row: t.row };
    let moved = false;

    const toBoard = (ev: PointerEvent) => {
      const pt = this.svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const m = this.svg.getScreenCTM();
      const p = pt.matrixTransform(m!.inverse());
      return { x: p.x, y: p.y };
    };

    const onMove = (ev: PointerEvent) => {
      if (!start) return;
      const p = toBoard(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      g.setAttribute('transform', `translate(${orig.col * CELL + dx}, ${orig.row * CELL + dy})`);
    };

    const endDrag = (ev: PointerEvent) => {
      if (!start) return;
      const p = toBoard(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      start = null;
      detach();
      if (!moved || ev.type === 'pointercancel') {
        g.setAttribute('transform', `translate(${orig.col * CELL}, ${orig.row * CELL})`);
        return;
      }
      const col = Math.round(orig.col + dx / CELL);
      const row = Math.round(orig.row + dy / CELL);
      this.callbacks.onMove(t.uid, col, row);
    };

    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };

    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      start = toBoard(ev);
      orig = { col: t.col, row: t.row };
      moved = false;
      this.callbacks.onSelect(t.uid);
      if (g.parentElement) this.gTokens.appendChild(g);
      try { g.setPointerCapture(ev.pointerId); } catch {  }
      detach();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });
  }
}

export function snapPlacement(col: number, row: number, size: 1 | 2 | 3): { col: number; row: number } | null {
  col = Math.max(0, Math.min(CELLS - size, col));
  row = Math.max(0, Math.min(CELLS - size, row));
  if (size === 3) {
    return { col: Math.round(col / 3) * 3, row: Math.round(row / 3) * 3 };
  }
  if (size === 2) {
    const lg = { c: Math.floor((col + 1) / 3), r: Math.floor((row + 1) / 3) };
    const c = Math.min(11, Math.max(0, lg.c));
    const r = Math.min(11, Math.max(0, lg.r));
    const offC = Math.min(1, Math.max(0, col - c * 3));
    const offR = Math.min(1, Math.max(0, row - r * 3));
    return { col: c * 3 + offC, row: r * 3 + offR };
  }
  const c = Math.min(11, Math.max(0, Math.floor(col / 3)));
  const r = Math.min(11, Math.max(0, Math.floor(row / 3)));
  return { col: c * 3 + 1, row: r * 3 + 1 };
}

export function footprint(t: { col: number; row: number; size: number }): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let dc = 0; dc < t.size; dc++) for (let dr = 0; dr < t.size; dr++) out.push({ col: t.col + dc, row: t.row + dr });
  return out;
}
