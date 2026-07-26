import type { TerrainPiece } from './types';

const KEY = 'ember-custom-maps-v1';

export interface PaletteItem {
  id: string;
  label: string;
  type: TerrainPiece['type'];
  cells: number;
  wide: boolean;
  rotatable: boolean;
}

export const PALETTE: PaletteItem[] = [
  { id: 'building', label: 'Building 3×3 (3", blocks LOS)', type: 'building', cells: 9, wide: true, rotatable: false },
  { id: 'high_wall', label: 'High wall 1×3 (3", blocks LOS)', type: 'high_wall', cells: 3, wide: false, rotatable: true },
  { id: 'low_wall', label: 'Low wall 1×3 (2", cover)', type: 'low_wall', cells: 3, wide: false, rotatable: true },
  { id: 'container2', label: 'Container 1×2 (1", fragile)', type: 'container', cells: 2, wide: false, rotatable: true },
  { id: 'container1', label: 'Container 1×1 (1", fragile)', type: 'container', cells: 1, wide: false, rotatable: false },
];

let counter = 1;

export function pieceCells(item: PaletteItem, col: number, row: number, vertical: boolean): { col: number; row: number }[] {
  if (item.wide) {
    const c = Math.floor(col / 3) * 3;
    const r = Math.floor(row / 3) * 3;
    const out: { col: number; row: number }[] = [];
    for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.push({ col: c + dc, row: r + dr });
    return out;
  }
  const out: { col: number; row: number }[] = [];
  for (let i = 0; i < item.cells; i++) out.push({ col: col + (vertical ? 0 : i), row: row + (vertical ? i : 0) });
  return out;
}

export function makePiece(item: PaletteItem, cells: { col: number; row: number }[]): TerrainPiece {
  return {
    id: `custom_${item.id}_${counter++}_${cells[0].col}_${cells[0].row}`,
    type: item.type,
    subCells: cells,
    height: item.type === 'building' || item.type === 'high_wall' ? 3 : item.type === 'low_wall' ? 2 : 1,
    blocksLos: item.type === 'building' || item.type === 'high_wall',
    providesProtection: item.type !== 'container',
    isFragile: item.type === 'container',
  };
}

export interface CustomZone {
  id: string;
  name: string;
  cells: { col: number; row: number }[];
}

export interface CustomMap {
  pieces: TerrainPiece[];
  zones: CustomZone[];
  deploy: { black: { col: number; row: number }[]; white: { col: number; row: number }[] };
}

export function emptyCustomMap(): CustomMap {
  return { pieces: [], zones: [], deploy: { black: [], white: [] } };
}

function normalise(raw: unknown): CustomMap {
  if (Array.isArray(raw)) return { ...emptyCustomMap(), pieces: raw as TerrainPiece[] };
  const o = (raw ?? {}) as Partial<CustomMap>;
  return {
    pieces: o.pieces ?? [],
    zones: o.zones ?? [],
    deploy: { black: o.deploy?.black ?? [], white: o.deploy?.white ?? [] },
  };
}

export function loadCustomMaps(): Record<string, CustomMap> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
  const out: Record<string, CustomMap> = {};
  for (const [name, v] of Object.entries(raw)) out[name] = normalise(v);
  return out;
}

export function loadCustomMap(name: string): CustomMap {
  return loadCustomMaps()[name] ?? emptyCustomMap();
}

export function saveCustomMap(name: string, map: CustomMap | TerrainPiece[]): void {
  const maps = loadCustomMaps();
  maps[name] = normalise(map);
  localStorage.setItem(KEY, JSON.stringify(maps));
}

export function deleteCustomMap(name: string): void {
  const maps = loadCustomMaps();
  delete maps[name];
  localStorage.setItem(KEY, JSON.stringify(maps));
}
