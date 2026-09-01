import type { TaskItem } from './tasks';
import type { BoardGrids, Facing, GameState, Marker, Side, SmokeScreen, StatusDef, TerrainPiece, Token, TokenShape } from './types';
import { DEFAULT_GRIDS, INTERCEPT_DEF, SHAPE_NOTE, statusCount, statusStacks } from './types';
import { mechPartUrl, squadLabel, squadNumber, tabImageUrl, tokenFace, tokenPrintUrl } from './data';
import {
  type BoardTheme, BOARD_FADE_BASE, boardArtUrl, boardTheme, clampBoardArt,
  clampGridColour, DEFAULT_BOARD, DEFAULT_GRID_COLOUR, gridPalette,
} from './boards';
import type { InspectInfo } from './inspector';

export const MECH_LAYER_ORDER = ['chasis', 'backpack', 'torso', 'leftHand', 'rightHand'] as const;

export const CELL = 30;
// Subcells per side for a board of `grids` Large Grids. This REPLACED the old
// `CELLS = 36` constant: the board is no longer one size, so nothing may cache
// its dimension at module load. A Board instance answers `this.cells`; code
// holding a GameState uses `cellsOf(state)` from types.ts.
export function cellsFor(grids: number): number {
  return grids * 3;
}
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
  // Drawn dimmed and dashed: this is what the TABLE would play here, shown in
  // the editor for a zone the map does not author, so an empty canvas does not
  // read as "this Task has no zones" when play would give it several.
  ghost?: boolean;
}

export interface DeployShape {
  // As BoardZone.ghost: the printed shape an unauthored map would deploy into.
  ghost?: boolean;
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
  // `at` is the element hovered, handed over so a page with a FLOATING inspect
  // box can position beside it. The board page ignores it — its box is docked.
  onInspect?(info: InspectInfo | null, at?: SVGElement): void;
  onMove(uid: number, col: number, row: number, forced?: boolean): void;
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

function badgeWidth(shape: TokenShape, stacked: boolean): number {
  const base = stacked ? 24 : 17;
  if (shape === 'hexagon') return base + 6;
  if (shape === 'triangle') return base + 11;
  if (shape === 'round') return base + 4;
  return base;
}

function badgeShape(shape: TokenShape, bx: number, by: number, w: number, tint: string): SVGElement {
  const skin = { fill: tint, stroke: '#0f1216', 'stroke-width': 1 };
  const h = 13;
  if (shape === 'hexagon') {
    const k = 4.5;
    const pts = [
      [bx - w / 2, by],
      [bx - w / 2 + k, by - h / 2],
      [bx + w / 2 - k, by - h / 2],
      [bx + w / 2, by],
      [bx + w / 2 - k, by + h / 2],
      [bx - w / 2 + k, by + h / 2],
    ];
    return el('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...skin });
  }
  if (shape === 'triangle') {
    const top = by - 9.5;
    const bot = by + 7.5;
    return el('polygon', { points: `${bx},${top} ${bx + w / 2},${bot} ${bx - w / 2},${bot}`, ...skin });
  }
  if (shape === 'round') {
    return el('rect', { x: bx - w / 2, y: by - h / 2, width: w, height: h, rx: h / 2, ...skin });
  }
  if (shape === 'state') {
    return el('rect', { x: bx - w / 2, y: by - h / 2, width: w, height: h, rx: 2, 'stroke-dasharray': '2.5 1.75', ...skin });
  }
  return el('rect', { x: bx - w / 2, y: by - h / 2, width: w, height: h, rx: 1.5, ...skin });
}

// Top-left and bottom-right corners cut, matching the squad and reference cards.
function notchedSquare(x: number, y: number, s: number, n: number): string {
  return `M${x + n} ${y} H${x + s} V${y + s - n} L${x + s - n} ${y + s} H${x} V${y + n} Z`;
}

function smokeHatchDefs(): SVGDefsElement {
  const defs = el('defs');
  for (const side of ['s1', 's2'] as const) {
    const p = el('pattern', {
      id: `smoke-hatch-${side}`,
      width: 13,
      height: 13,
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
    });
    p.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 13, class: `smoke-hatch smoke-hatch-${side}` }));
    defs.appendChild(p);
  }
  return defs;
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
  private gWorld!: SVGGElement;
  private flipped = false;
  private gGrid!: SVGGElement;
  private theme: BoardTheme = boardTheme(DEFAULT_BOARD);
  // Held rather than read back off the node, because buildGrid throws the node
  // away on every theme and size change and has to paint the new one dimmed.
  private artOpacity = 1;
  private artImg: SVGImageElement | null = null;
  private gridColour = DEFAULT_GRID_COLOUR;
  private alwaysGrid = false;
  private gridBorder: SVGRectElement | null = null;
  private gZones!: SVGGElement;
  private gEnv!: SVGGElement;
  private gTerrain: SVGGElement;
  private gTokens: SVGGElement;
  // Everything currently standing, staged by renderTokens so a unit's token
  // strip can pick a side that is not already somebody else's base.
  private onBoard: Token[] = [];
  private gOverlay: SVGGElement;
  private gHighlight: SVGGElement;
  private gMarkers!: SVGGElement;
  private gTaskItems!: SVGGElement;
  private gSmoke!: SVGGElement;
  private gPick!: SVGGElement;
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
  // How many Large Grids this board is drawn at. Set by setGrids() when a map
  // is loaded; the printed 12 until then, so a page that never calls it keeps
  // the board it always had.
  private grids: BoardGrids = DEFAULT_GRIDS;

  // Subcells per side, and the world-space edge length in px. Getters rather
  // than fields because they must never go stale behind a resize: the old
  // module-level SIZE was computed once at load, which is exactly the bug this
  // slice removes.
  get cells(): number {
    return cellsFor(this.grids);
  }

  private get size(): number {
    return CELL * this.cells;
  }

  // Which board this is drawn at, for callers that have to do their own
  // geometry (snapPlacement and the free-spot scans).
  get gridCount(): BoardGrids {
    return this.grids;
  }

  // Change the board's dimension. Everything measured in world space has to be
  // rebuilt: the viewBox, the grid, the flip transform's centre and the zoom
  // fit. Cheap and rare (a map load), so it redraws rather than patching.
  setGrids(grids: BoardGrids): void {
    if (this.grids === grids) return;
    this.grids = grids;
    this.svg.setAttribute('viewBox', `${-M} ${-M} ${this.size + 2 * M} ${this.size + 2 * M}`);
    // The flip pivots on the board's centre, which just moved.
    this.gWorld.setAttribute('transform', this.flipped ? `rotate(180 ${this.size / 2} ${this.size / 2})` : '');
    // Swapped directly rather than through setTheme(), which early-returns when
    // the theme id is unchanged -- and it IS unchanged here, since only the
    // size moved. Going through it would leave the old board's grid painted.
    const fresh = this.buildGrid();
    this.gGrid.replaceWith(fresh);
    this.gGrid = fresh;
    this.fit();
  }

  // Screen to board. Deliberately the WORLD group's matrix and not the svg's:
  // the world carries the half-turn that puts a player's own Deployment Zone at
  // the bottom, and taking it from here is what makes the flip a pure view
  // change. Every click is converted back into the one set of coordinates the
  // state and the commands are written in, so nothing downstream — the rules,
  // the relay, the fingerprint — ever learns which way up a screen is.
  private toWorld(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const pt = this.svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(this.gWorld.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }

  private cellAt(ev: PointerEvent): { col: number; row: number } | null {
    const p = this.toWorld(ev);
    const col = Math.floor(p.x / CELL);
    const row = Math.floor(p.y / CELL);
    if (col < 0 || row < 0 || col >= this.cells || row >= this.cells) return null;
    return { col, row };
  }

  // Which way up this screen draws the board. The state never changes; only
  // this does, and only for the player whose zone would otherwise be at the top
  // — because at a real table you sit behind your own units.
  setFlipped(on: boolean): void {
    if (this.flipped === on) return;
    this.flipped = on;
    this.gWorld.setAttribute('transform', on ? `rotate(180 ${this.size / 2} ${this.size / 2})` : '');
    // Text and unit art turn back the right way up from a stylesheet rule; a
    // facing arrow, an arc and a drawn route all correctly turn with the board.
    this.svg.classList.toggle('flipped', on);
  }

  constructor(container: HTMLElement, callbacks: BoardCallbacks) {
    this.callbacks = callbacks;
    this.svg = el('svg', {
      viewBox: `${-M} ${-M} ${this.size + 2 * M} ${this.size + 2 * M}`,
      id: 'board',
    });
    this.svg.appendChild(smokeHatchDefs());
    // Everything that lives in board coordinates hangs off one group, so the
    // half-turn that puts a player's own zone at the bottom is a single
    // attribute rather than a rewrite of every draw call — and so `toWorld`
    // has one matrix to undo it with.
    this.gWorld = el('g', { class: 'board-world' });
    this.svg.appendChild(this.gWorld);
    this.gGrid = this.buildGrid();
    this.gWorld.appendChild(this.gGrid);
    this.gZones = el('g', { class: 'zones', 'pointer-events': 'none' });
    this.gWorld.appendChild(this.gZones);
    // Directly on the mat: an Environment Card is laid on the board, and the
    // terrain, markers and units that follow all stand on top of it.
    this.gEnv = el('g', { class: 'env-layer' });
    this.gWorld.appendChild(this.gEnv);
    this.gTerrain = el('g');
    this.gMarkers = el('g', { class: 'markers' });
    this.gTaskItems = el('g', { class: 'task-items', 'pointer-events': 'none' });
    this.gSmoke = el('g', { class: 'smoke-layer' });
    this.gHighlight = el('g', { class: 'highlight', 'pointer-events': 'none' });
    this.gTokens = el('g');
    this.gGhost = el('g', { class: 'ghost', 'pointer-events': 'none' });
    this.gOverlay = el('g', { class: 'overlay', 'pointer-events': 'none' });
    // Above the tokens, so a unit standing on a candidate Grid cannot eat the click.
    this.gPick = el('g', { class: 'pick-layer' });
    this.gWorld.appendChild(this.gTerrain);
    this.gWorld.appendChild(this.gMarkers);
    this.gWorld.appendChild(this.gTaskItems);
    this.gWorld.appendChild(this.gSmoke);
    this.gWorld.appendChild(this.gHighlight);
    this.gWorld.appendChild(this.gTokens);
    this.gWorld.appendChild(this.gGhost);
    this.gWorld.appendChild(this.gOverlay);
    this.gWorld.appendChild(this.gPick);
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

    // Panels float over the board inside this same container, so a wheel event
    // that lands on something with its own scrollbar belongs to that panel.
    const overOwnScroller = (ev: WheelEvent): boolean => {
      // Stop at the board's own scroll wrapper: zooming in makes it scrollable,
      // and treating that as a panel would kill wheel-zoom over the board itself.
      let el = ev.target as HTMLElement | null;
      while (el && el !== container && el !== this.scrollWrap) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };
    container.addEventListener(
      'wheel',
      (ev) => {
        if (overOwnScroller(ev)) return;
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

  // Re-fit to the container now. The ResizeObserver covers ordinary layout
  // changes, but a host that mounts the board inside a column it is still
  // sizing needs to be able to ask directly.
  fit(): void {
    this.applyZoom();
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.6, Math.min(3.5, z));
    this.applyZoom();
  }

  setBoardTheme(id: string): void {
    const next = boardTheme(id);
    if (next.id === this.theme.id && this.gGrid) return;
    this.theme = next;
    const fresh = this.buildGrid();
    this.gGrid.replaceWith(fresh);
    this.gGrid = fresh;
  }

  // Fades the art toward the board's base colour. Lives beside setBoardTheme
  // rather than inside it: the theme setter early-returns when the id has not
  // changed, which is exactly the case here.
  setBoardArt(v: number): void {
    this.artOpacity = clampBoardArt(v);
    if (this.artImg) this.artImg.setAttribute('opacity', String(this.artOpacity));
  }

  setGridColour(c: string): void {
    this.gridColour = clampGridColour(c);
    if (this.gGrid) this.paintGrid(this.gGrid);
  }

  // Draws our grid over art that already has one printed on it. The official
  // boards are the reason: their printed grid goes faint under a mech.
  setAlwaysGrid(on: boolean): void {
    this.alwaysGrid = !!on;
    if (this.gGrid) this.paintGrid(this.gGrid);
  }

  // Colours a grid group. Takes the group rather than reading this.gGrid,
  // because buildGrid has to paint the one it is still assembling -- its
  // callers only swap it in afterwards.
  //
  // NOT a rebuild: buildGrid re-encodes a generated theme's art into a fresh
  // data URI, which is thousands of polygons, and this runs on every tick of a
  // colour picker being dragged.
  private paintGrid(g: SVGGElement): void {
    const pal = gridPalette(this.gridColour);
    // A board whose art draws its own grid keeps ours hidden unless asked.
    const show = this.alwaysGrid || !this.theme.printsOwnGrid;
    for (const ln of g.querySelectorAll('line')) {
      const major = ln.classList.contains('g-major');
      ln.setAttribute('stroke', show ? (major ? pal.major : pal.minor) : 'transparent');
    }
    // The letters and numbers sit OUTSIDE the board, so art never hides them
    // and they are not part of the toggle.
    this.svg.style.setProperty('--grid-label', pal.label);
    this.gridBorder?.setAttribute('stroke', pal.border);
  }

  private buildGrid(): SVGGElement {
    const t = this.theme;
    const g = el('g', { id: 'grid' });
    const art = boardArtUrl(t, this.size);
    // Neutral under art, the theme's own colour when there is none: dimming a
    // board should fade it toward the dark the whole app is built on rather
    // than toward whatever tint that particular board happens to be.
    g.appendChild(el('rect', {
      x: 0, y: 0, width: this.size, height: this.size, fill: art ? BOARD_FADE_BASE : t.base,
    }));
    this.artImg = null;
    if (art) {
      const img = el('image', { x: 0, y: 0, width: this.size, height: this.size, 'pointer-events': 'none' });
      img.setAttribute('href', art);
      img.setAttribute('opacity', String(this.artOpacity));
      g.appendChild(img);
      this.artImg = img;
    }
    // Appended AFTER the art, so the lines already sit over it. Their colour is
    // left to paintGrid at the end, which is also what the pickers call.
    for (let i = 0; i <= this.cells; i++) {
      const large = i % 3 === 0;
      const p = i * CELL;
      const cls = large ? 'g-major' : 'g-minor';
      const w = large ? 1.6 : 0.6;
      g.appendChild(el('line', { x1: p, y1: 0, x2: p, y2: this.size, class: cls, 'stroke-width': w }));
      g.appendChild(el('line', { x1: 0, y1: p, x2: this.size, y2: p, class: cls, 'stroke-width': w }));
    }
    for (let i = 0; i < this.grids; i++) {
      const c = i * 3 * CELL + 1.5 * CELL;
      const col = el('text', { x: c, y: -8, 'text-anchor': 'middle', class: 'grid-label' });
      col.textContent = String.fromCharCode(65 + i);
      const row = el('text', { x: -10, y: c + 4, 'text-anchor': 'middle', class: 'grid-label' });
      row.textContent = String(i + 1);
      g.appendChild(col);
      g.appendChild(row);
    }
    const border = el('rect', { x: 0, y: 0, width: this.size, height: this.size, fill: 'none', 'stroke-width': 2.5 });
    g.appendChild(border);
    this.gridBorder = border as SVGRectElement;
    this.paintGrid(g);
    return g;
  }

  private attachInspect(g: SVGGElement, info: InspectInfo): void {
    // The element goes with the info so a floating box knows where to stand.
    // Only on ENTER: on leave the box is being hidden, and re-anchoring it to a
    // node the cursor has just left would move it on its way out.
    g.addEventListener('pointerenter', () => this.callbacks.onInspect?.(info, g));
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
          p.isFragile ? 'Destructible. Click to destroy; a Large unit moving in Crushes it' : 'Cannot be destroyed',
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

  renderZones(zones: BoardZone[], deploy: BoardDeployment | null, claimed?: Record<string, Side[]>): void {
    this.gZones.replaceChildren();
    const LG = 3 * CELL;

    if (deploy) {
      for (const side of ['black', 'white'] as const) {
        const shape = deploy[side];
        if (!shape) continue;
        const g = el('g', { class: `dz dz-${side}${shape.ghost ? ' dz-ghost' : ''}` });
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
          // CENTRED ON THE WHOLE SHAPE, as the rect branch above is.
          //
          // This used to centre on the single topmost Grid. The label is around
          // 190px of 14px bold and a Grid is 90px, so it hung ~50px off each
          // side of that one Grid -- and when the Grid was at column 0 the left
          // half fell off the board and was clipped, leaving "CK DEPLOYMENT
          // ZONE". Only AUTHORED deployment reaches this branch (the printed
          // shapes are rects), which is why it survived until a painted map was
          // played on.
          const cols = shape.cells.map((c) => c.col);
          const rows = shape.cells.map((c) => c.row);
          lx = ((Math.min(...cols) + Math.max(...cols) + 1) / 2) * LG;
          ly = ((Math.min(...rows) + Math.max(...rows) + 1) / 2) * LG + 6;
        } else {
          continue;
        }
        const label = el('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'dz-label' });
        label.textContent = shape.label ?? `${side === 'black' ? 'BLACK' : 'WHITE'} DEPLOYMENT ZONE`;
        // KEPT ON THE BOARD. A zone narrower than its own label still overflows
        // it, which is fine over the battlefield and not fine over the edge:
        // anything outside the viewBox is simply cut off. Estimated rather than
        // measured because getComputedTextLength needs the element laid out,
        // and this runs while the tree is still being built.
        const half = (label.textContent.length * 9.5) / 2;
        const boardPx = this.grids * LG;
        if (boardPx > half * 2) {
          label.setAttribute('x', String(Math.min(Math.max(lx, half), boardPx - half)));
        }
        g.appendChild(label);
        this.gZones.appendChild(g);
      }
    }

    for (const z of zones) {
      const g = el('g', { class: z.ghost ? 'tz tz-ghost' : 'tz' });
      for (const c of z.cells) {
        g.appendChild(el('rect', { x: c.col * LG, y: c.row * LG, width: LG, height: LG, class: 'zone-fill' }));
      }
      if (z.cells.length) g.appendChild(el('path', { d: outlinePath(z.cells, LG), class: 'zone-edge' }));
      // A Secondary Task can designate this zone. Both sides may name the same
      // one, so the second claim is drawn inset rather than on top of the first.
      const by = claimed?.[z.name] ?? [];
      by.forEach((side, i) => {
        g.appendChild(el('path', {
          d: outlinePath(z.cells, LG),
          class: `tz-claim tz-claim-${side}`,
          'stroke-dasharray': '14 14',
          'stroke-dashoffset': i ? 14 : 0,
        }));
      });
      const first = z.cells[0];
      if (first) {
        // The name sits at the top of its Grid rather than the middle of it,
        // because the middle is where a Task Item goes and a token over the
        // name leaves the zone unreadable.
        const label = el('text', {
          x: first.col * LG + LG / 2,
          y: first.row * LG + 15,
          'text-anchor': 'middle',
          class: 'tz-label',
        });
        label.textContent = z.name;
        g.appendChild(label);
        // Whose claim the ring is. Squads can share a faction and so a colour,
        // so the number is what actually tells them apart.
        by.forEach((side, i) => {
          const bx = first.col * LG + LG - 13 - i * 20;
          const byy = first.row * LG + 13;
          const badge = el('g', { class: `tz-claimtag tz-claim-${side}` });
          badge.appendChild(el('circle', { cx: bx, cy: byy, r: 9 }));
          const num = el('text', { x: bx, y: byy + 4, 'text-anchor': 'middle', class: 'tz-claimnum' });
          num.textContent = side === 's1' ? '1' : '2';
          badge.appendChild(num);
          g.appendChild(badge);
        });
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
        lines: ['Scenario objective. The scenario briefing says how it scores.'],
      });
      this.gMarkers.appendChild(g);
    }
  }

  // Task Items (5.3). A Black Box sits on a Small Grid and can overlap a Unit; a
  // Terminal and a Control dial mark their whole Tactical Zone, so they are drawn
  // at the centre of the Zone rather than on a cell.
  renderTaskItems(items: TaskItem[], centre: (zone: string) => { c: number; r: number } | null): void {
    this.gTaskItems.replaceChildren();
    for (const it of items) {
      let cx: number;
      let cy: number;
      // An EXPLICIT spot wins for any kind, not just a Black Box. Only Boxes
      // carried one before, because only Boxes could be placed; an authored map
      // can now say where a Terminal or a Control marker sits too, and the
      // zone-centre below stays the fallback for everything unplaced.
      if (it.col !== undefined && it.row !== undefined) {
        cx = it.col * CELL + CELL / 2;
        cy = it.row * CELL + CELL / 2;
      } else {
        const g = centre(it.zone);
        if (!g) continue;
        cx = g.c * 3 * CELL + 1.5 * CELL;
        cy = g.r * 3 * CELL + 1.5 * CELL;
      }
      const side = it.kind === 'control' ? it.control : it.kind === 'terminal' ? it.accessed : null;
      const held = it.kind === 'blackbox' && it.bearerUid !== undefined;
      const g = el('g', {
        class: `task-item task-${it.kind}${side ? ` side-${side}` : ''}${held ? ' carried' : ''}`,
        'data-task-item': it.id,
      });
      g.appendChild(el('circle', { cx, cy, r: it.kind === 'blackbox' ? 9 : 13 }));
      const icon = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'task-icon' });
      icon.textContent = it.kind === 'blackbox' ? '◆' : it.kind === 'terminal' ? 'W' : '◉';
      g.appendChild(icon);
      this.gTaskItems.appendChild(g);
    }
  }

  // `preview` is a placement the player has made but not confirmed. It is not
  // on the board as far as the state is concerned, but showing only an outline
  // meant they could not see what they were placing or drag it somewhere else.
  // `preview` is one token drawn as it is about to be rather than as it is: a
  // square and facing for a unit still being placed, or just a facing for one
  // already down that its player is turning.
  renderTokens(state: GameState, preview?: { uid: number; col?: number; row?: number; facing?: Facing }): void {
    this.gTokens.replaceChildren();
    // The token strip has to know what is beside each unit before it picks a
    // side to hang off, so the neighbours are staged here for buildToken.
    this.onBoard = state.tokens.filter((x) => x.deployed !== false);
    for (const t of state.tokens) {
      const pv = preview && preview.uid === t.uid ? preview : null;
      // A unit awaiting deployment is in the squad but not on the board yet.
      if (t.deployed !== false) {
        this.gTokens.appendChild(this.buildToken(pv?.facing !== undefined ? { ...t, facing: pv.facing } : t));
      } else if (pv && pv.col !== undefined && pv.row !== undefined) {
        const g = this.buildToken({ ...t, col: pv.col, row: pv.row, facing: pv.facing ?? t.facing });
        g.classList.add('pending');
        this.gTokens.appendChild(g);
      }
    }
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

    // Colour alone cannot separate two squads that picked the same faction, and
    // a mirror match is the ordinary case rather than a corner one, so the
    // number is always on the token. It sits bottom-left, away from the facing
    // arrow, which rotates through the other three corners.
    const badgeR = 7;
    const badgeX = cx - half + badgeR + 2.5;
    const badgeY = cy + half - badgeR - 2.5;
    g.appendChild(el('circle', { cx: badgeX, cy: badgeY, r: badgeR, class: 'token-squad-dot' }));
    const num = el('text', { x: badgeX, y: badgeY + 3.2, 'text-anchor': 'middle', class: 'token-squad-n' });
    num.textContent = String(squadNumber(t.side));
    g.appendChild(num);

    if (wrecked || shutdown) {
      const tag = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: `token-status ${wrecked ? 'is-wrecked' : 'is-shutdown'}` });
      tag.textContent = wrecked ? 'DESTROYED' : 'SHUTDOWN';
      g.appendChild(tag);
    }

    const label = el('text', { x: cx, y: cy + half + 9, 'text-anchor': 'middle', class: 'token-label' });
    label.textContent = t.label;
    g.appendChild(label);

    // A token flipped to its red side is drawn red, the way it looks on the table
    // once it is one round from expiring (2.5.3).
    const expiring = new Set(t.expiring ?? []);
    const active: { def: StatusDef; n: number; counted: boolean; spent: boolean; hint: string }[] = statusStacks(t.statuses).map(
      ({ def, n }) => ({
        def: expiring.has(def.id) ? { ...def, tint: '#e05c5c' } : def,
        n,
        counted: !!def.stacking && n > 1,
        spent: false,
        // Only the expiring line survives, because it is a RULE — a red face
        // means this comes off in the End Phase. "Toggle it from the Squads
        // tab" was advice, not a rule, and it went stale the moment that row
        // became a handle.
        hint: expiring.has(def.id) ? 'Showing its red side, so it comes off at the end of this round.' : '',
      }),
    );
    const slots = Object.keys(t.intercept ?? {}).length;
    if (slots > 0) {
      const left = Object.values(t.intercept!).reduce((s, n) => s + n, 0);
      active.push({
        def: INTERCEPT_DEF,
        n: left,
        counted: true,
        spent: left === 0,
        hint: left
          ? 'Spend one with the Intercept button on that Part’s action in the Details tab.'
          : 'Every Interception Token on this unit is spent, so it cannot Intercept again this game.',
      });
    }
    if (active.length) {
      // Tokens run DOWN THE RIGHT EDGE of the base, the way they are laid beside
      // a model, rather than in a row above it: a centred row is as wide as the
      // number of tokens, so three of them already overhang a Large unit and a
      // Drone disappears under its own labels. A column is one token wide
      // whatever is on, and the printed art is what a player will meet on the
      // table — the shape IS the stacking rule, so showing it teaches 2.5.3
      // without a word. Anything past the base's height folds into a +N chip
      // that opens the unit's token panel.
      const SZ = 18;
      const GAP = 2;
      // Slots that fit WITHIN the base's own height, so the column never makes
      // the unit taller than it is. A Small Drone is 30px and gets two anyway,
      // since one token plus a "+N" is the least that can say anything.
      const room = Math.max(2, Math.floor((half * 2) / (SZ + GAP)));
      const over = active.length > room ? active.length - (room - 1) : 0;
      const shown = over ? active.slice(0, room - 1) : active;
      // Which side to hang the strip off. Right by default, but a unit standing
      // in the next Grid would wear its neighbour's tokens - so the strip looks
      // first for a free side. Measured in SMALL CELLS against every other
      // base, the same footprint test the board uses everywhere else.
      const clash = (dir: -1 | 1): boolean => {
        const x0 = dir === 1 ? t.col + t.size : t.col - 1;
        return this.onBoard.some(
          (o) =>
            o.uid !== t.uid &&
            !o.aerial === !t.aerial &&
            x0 >= o.col && x0 < o.col + o.size &&
            t.row < o.row + o.size && o.row < t.row + t.size,
        );
      };
      // Right unless it is taken and the left is free; if both are taken the
      // strip stays right, because a covered token still beats a hidden one.
      const side: -1 | 1 = clash(1) && !clash(-1) ? -1 : 1;
      const sx = side === 1 ? cx + half + 4 : cx - half - 4 - SZ;
      let sy = cy - half;
      const place = (): { x: number; y: number } => {
        const at = { x: sx, y: sy };
        sy += SZ + GAP;
        return at;
      };
      shown.forEach(({ def: s, n, counted, spent, hint }) => {
        const at = place();
        const face = tokenFace(s.id, s.decay, s.tint === '#e05c5c');
        const badge = el('g', { class: `status-badge shape-${s.shape}${spent ? ' spent' : ''}` });
        if (face.art) {
          // No `pointer-events: none` here: the group has no geometry of its
          // own, so the image IS the hit area. Suppressing it left the badge
          // unhoverable and silently killed the inspect text on every token.
          badge.appendChild(el('image', {
            href: tokenPrintUrl(face.art), x: at.x, y: at.y, width: SZ, height: SZ,
            class: 'tok-art',
          }));
        } else {
          // No scan for this one yet, so it falls back to its shape in the
          // DURATION colour — same reading, just without the artwork.
          badge.appendChild(badgeShape(s.shape, at.x + SZ / 2, at.y + SZ / 2, SZ - 2, face.colour));
          const txt = el('text', {
            x: at.x + SZ / 2, y: at.y + SZ / 2 + 3, 'text-anchor': 'middle', class: 'status-badge-text',
          });
          txt.textContent = s.icon;
          badge.appendChild(txt);
        }
        if (counted) {
          badge.appendChild(el('circle', { cx: at.x + SZ - 2, cy: at.y + SZ - 2, r: 6, class: 'tok-n-bg' }));
          const cn = el('text', { x: at.x + SZ - 2, y: at.y + SZ + 0.5, 'text-anchor': 'middle', class: 'tok-n' });
          cn.textContent = String(n);
          badge.appendChild(cn);
        }
        // The RULE and nothing else. The long note carries our commentary —
        // which button greys out, how to click it — and over a board, mid-turn,
        // that buries the one line the reader came for. The shape line stays
        // because it IS a rule, and it is the thing the artwork is teaching.
        this.attachInspect(badge as SVGGElement, {
          title: counted ? `${s.label} ×${n}` : s.label,
          sub: `${s.icon} · on ${t.label}`,
          lines: [s.rule, SHAPE_NOTE[s.shape], hint],
        });
        g.appendChild(badge);
      });
      if (over) {
        const at = place();
        const more = el('g', { class: 'status-badge tok-more' });
        more.appendChild(el('rect', { x: at.x, y: at.y, width: SZ, height: SZ, rx: 4, class: 'tok-more-bg' }));
        const txt = el('text', { x: at.x + SZ / 2, y: at.y + SZ / 2 + 3.5, 'text-anchor': 'middle', class: 'tok-more-text' });
        txt.textContent = `+${over}`;
        more.appendChild(txt);
        this.attachInspect(more as SVGGElement, {
          title: `${over} more token${over === 1 ? '' : 's'}`,
          sub: `on ${t.label}`,
          lines: [active.slice(shown.length).map((a) => a.def.label).join(', ')],
        });
        g.appendChild(more);
      }
    }

    const parts = Object.entries(t.partStates);
    const gone = parts.filter(([, s]) => s === 'destroyed').length;
    const hurt = parts.filter(([, s]) => s === 'damaged').length;
    this.attachInspect(g, {
      title: t.label,
      sub: `${squadLabel(t.side)} · ${t.kind}`,
      lines: [
        `Stance ${t.stance.toUpperCase()}${t.link !== undefined ? ` · Link ${t.link}` : ''}`,
        `Facing ${['North', 'East', 'South', 'West'][t.facing]}`,
        wrecked ? 'DESTROYED' : hurt || gone ? `${hurt} damaged, ${gone} destroyed part(s)` : 'All parts intact',
      ],
    });

    g.addEventListener('pointerenter', () => this.callbacks.onHover?.(t.uid));
    g.addEventListener('pointerleave', () => this.callbacks.onHover?.(null));

    this.attachDrag(g, t);
    return g;
  }

  // `cards` carries the name and rule for each placement, because the board
  // has no card data of its own and the hover box should read the rule rather
  // than an id.
  renderEnvironments(
    placed: { card: string; col: number; row: number }[],
    cards: Record<string, { name: string; text: string }>,
  ): void {
    this.gEnv.replaceChildren();
    for (const e of placed) {
      const x = e.col * 3 * CELL;
      const y = e.row * 3 * CELL;
      const def = cards[e.card];
      const g = el('g', { class: 'env', 'data-env': `${e.col},${e.row}` });
      g.appendChild(el('rect', {
        x: x + 2, y: y + 2, width: 3 * CELL - 4, height: 3 * CELL - 4,
        rx: 7, class: 'env-body',
      }));
      const label = el('text', {
        x: x + 1.5 * CELL, y: y + 3 * CELL - 9, 'text-anchor': 'middle', class: 'env-name',
      });
      label.textContent = (def?.name ?? e.card).toUpperCase();
      g.appendChild(label);
      this.attachInspect(g, {
        title: def?.name ?? e.card,
        sub: `Environment Card · Grid ${String.fromCharCode(65 + e.col)}${e.row + 1}`,
        lines: [
          def?.text ?? 'This Grid has an environmental effect.',
          'Environment Cards are placed as the battlefield is set up, and the number allowed is printed on the Battlefield Card (5.4.1).',
        ],
      });
      this.gEnv.appendChild(g);
    }
  }

  renderSmoke(smoke: SmokeScreen[]): void {
    this.gSmoke.replaceChildren();
    const perGrid = new Map<string, SmokeScreen[]>();
    for (const s of smoke) {
      const k = `${s.col},${s.row}`;
      perGrid.set(k, [...(perGrid.get(k) ?? []), s]);
    }
    for (const [, list] of perGrid) {
      list.forEach((s, i) => {
        const x = s.col * 3 * CELL;
        const y = s.row * 3 * CELL;
        const inset = 3 + i * 5;
        const size = 3 * CELL - inset * 2;
        const d = notchedSquare(x + inset, y + inset, size, Math.min(13, size / 5));
        const g = el('g', { class: `smoke smoke-${s.side}`, 'data-smoke': `${s.col},${s.row},${s.side}` });
        g.appendChild(el('path', { d, class: 'smoke-body', fill: `url(#smoke-hatch-${s.side})` }));
        g.appendChild(el('path', { d, class: 'smoke-frame' }));
        this.attachInspect(g, {
          title: 'Smoke Screen',
          sub: `${squadLabel(s.side)} · Grid ${String.fromCharCode(65 + s.col)}${s.row + 1}`,
          lines: [
            'Line of sight cannot be established through this Grid for Firing Actions, and a unit standing in it can neither shoot out nor be shot at (rulebook 4.16).',
            'Melee and Projectile Actions ignore Smoke Screens completely.',
            'In the End Phase every isolated screen comes off, plus one from each connected group.',
          ],
        });
        this.gSmoke.appendChild(g);
      });
    }
  }

  // The route a unit will walk, drawn through the centre of each Large Grid and
  // tinted to the owning side so it is obvious whose move is being planned.
  showMovePath(path: { c: number; r: number }[], side: Side, locked = false): void {
    this.gOverlay.replaceChildren();
    if (path.length < 2) return;
    const pt = (g: { c: number; r: number }) => `${g.c * 3 * CELL + 1.5 * CELL},${g.r * 3 * CELL + 1.5 * CELL}`;
    const g = el('g', { class: `move-path side-${side}${locked ? ' locked' : ''}` });
    g.appendChild(el('polyline', { points: path.map(pt).join(' '), class: 'move-path-line' }));
    for (const step of path.slice(1, -1)) {
      const [x, y] = pt(step).split(',').map(Number);
      g.appendChild(el('circle', { cx: x, cy: y, r: 3.5, class: 'move-path-dot' }));
    }
    const last = path[path.length - 1];
    const [ex, ey] = pt(last).split(',').map(Number);
    g.appendChild(el('circle', { cx: ex, cy: ey, r: 7, class: 'move-path-end' }));
    this.gOverlay.appendChild(g);
  }

  clearMovePath(): void {
    this.gOverlay.replaceChildren();
  }

  // Walks the token along the path one Large Grid at a time so the other player
  // can see the route taken rather than the unit teleporting. Uses timers rather
  // than rAF, which never fires when the pane is not compositing.
  // `stops` are small-cell positions, the last being exactly where state will put
  // the unit, so the animation cannot land somewhere the model disagrees with.
  // One continuous animation across every waypoint rather than a timer per hop.
  // Chaining CSS transitions raced the timers and produced a slide-then-jump, so
  // the whole route is handed to the engine at once and eased end to end.
  animateMove(uid: number, stops: { col: number; row: number }[], done: () => void): void {
    const g = this.gTokens.querySelector<SVGGElement>(`[data-uid="${uid}"]`);
    if (!g || stops.length < 2) {
      done();
      return;
    }
    const hops = stops.length - 1;
    const total = Math.min(1500, 260 + hops * 170);
    const frames = stops.map((s) => ({ transform: `translate(${s.col * CELL}px, ${s.row * CELL}px)` }));
    const settle = () => {
      if (g.dataset.moveDone) return;
      g.dataset.moveDone = '1';
      g.classList.remove('moving');
      g.setAttribute('transform', `translate(${stops[hops].col * CELL}, ${stops[hops].row * CELL})`);
      delete g.dataset.moveDone;
      done();
    };
    g.classList.add('moving');
    // The pane does not advance the animation clock when it is not compositing, so
    // a timer guarantees the move completes even if onfinish never fires.
    window.setTimeout(settle, total + 120);
    try {
      const anim = g.animate(frames, { duration: total, easing: 'ease-in-out', fill: 'forwards' });
      anim.onfinish = settle;
    } catch {
      settle();
    }
  }

  showSmokeTargets(grids: { c: number; r: number; ok: boolean }[], onPick: (c: number, r: number) => void): void {
    this.clearHighlights();
    const g = el('g', { class: 'smoke-pick' });
    for (const cell of grids) {
      const rect = el('rect', {
        x: cell.c * 3 * CELL + 2,
        y: cell.r * 3 * CELL + 2,
        width: 3 * CELL - 4,
        height: 3 * CELL - 4,
        rx: 4,
        class: `smoke-target${cell.ok ? '' : ' blocked'}`,
      });
      // Picks resolve on pointerdown: the board's own pointerup deselects, which
      // tears this layer down before a click event could ever reach the rect.
      if (cell.ok) {
        rect.addEventListener('pointerdown', (ev) => {
          if ((ev as PointerEvent).button !== 0) return;
          ev.stopPropagation();
          ev.preventDefault();
          onPick(cell.c, cell.r);
        });
      }
      g.appendChild(rect);
    }
    this.gPick.appendChild(g);
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
    const cells = this.grids;
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
    const R = this.size * 1.6;
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
      clip.appendChild(el('rect', { x: 0, y: 0, width: this.size, height: this.size }));
      this.svg.appendChild(clip);
    }
    g.setAttribute('clip-path', `url(#${clipId})`);
    g.appendChild(mk(t.facing * 90, 'arc-forward'));
    g.appendChild(mk(t.facing * 90 + 180, 'arc-rear'));
    this.gHighlight.appendChild(g);
  }

  clearHighlights(): void {
    this.gHighlight.replaceChildren();
    this.gPick.replaceChildren();
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

    const toBoard = (ev: PointerEvent) => this.toWorld(ev);

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
      this.callbacks.onMove(t.uid, col, row, ev.shiftKey);
    };

    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };

    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      // A unit is not draggable while the board is in a modal interaction —
      // drawing a movement route, painting the map editor, placing a unit.
      // Grabbing your own Mech mid-route used to start a token drag that fought
      // the route being traced under it and left the line drawn from a position
      // the unit was not in.
      //
      // Derived from panEnabled rather than a flag of its own: that is already
      // false in exactly these states and nowhere else, so there is no second
      // lifecycle to keep in step. The return comes BEFORE stopPropagation so
      // the press falls through to the board, and a route can be traced across
      // the unit's own base instead of stopping dead on it.
      if (!this.panEnabled) return;
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

// `grids` defaults to the printed 12 so an un-migrated caller keeps the exact
// behaviour it had. Every caller that can see the state should pass
// gridsOf(state): on a 16 or 18 board the old default would clamp a legal
// placement back onto the printed board's last Grid, silently.
export function snapPlacement(col: number, row: number, size: 1 | 2 | 3, grids: number = DEFAULT_GRIDS): { col: number; row: number } | null {
  const cells = cellsFor(grids);
  const last = grids - 1;
  col = Math.max(0, Math.min(cells - size, col));
  row = Math.max(0, Math.min(cells - size, row));
  if (size === 3) {
    return { col: Math.round(col / 3) * 3, row: Math.round(row / 3) * 3 };
  }
  if (size === 2) {
    const lg = { c: Math.floor((col + 1) / 3), r: Math.floor((row + 1) / 3) };
    const c = Math.min(last, Math.max(0, lg.c));
    const r = Math.min(last, Math.max(0, lg.r));
    const offC = Math.min(1, Math.max(0, col - c * 3));
    const offR = Math.min(1, Math.max(0, row - r * 3));
    return { col: c * 3 + offC, row: r * 3 + offR };
  }
  const c = Math.min(last, Math.max(0, Math.floor(col / 3)));
  const r = Math.min(last, Math.max(0, Math.floor(row / 3)));
  return { col: c * 3 + 1, row: r * 3 + 1 };
}

export function footprint(t: { col: number; row: number; size: number }): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let dc = 0; dc < t.size; dc++) for (let dr = 0; dr < t.size; dr++) out.push({ col: t.col + dc, row: t.row + dr });
  return out;
}
