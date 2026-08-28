import type { BoardGrids, TerrainPiece } from './types';

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
  // Board size in Large Grids. ABSENT MEANS THE PRINTED 12x12, which is every
  // map saved before larger boards existed -- do not default it to anything
  // else, and do not write it on load, or an old map silently changes size.
  grids?: BoardGrids;
  pieces: TerrainPiece[];
  zones: CustomZone[];
  deploy: { black: { col: number; row: number }[]; white: { col: number; row: number }[] };
  // Base objective spots, for a map that places them the same way whatever the
  // Task is. Rare -- objectives usually belong to a task layer -- but a layer
  // with no objectives of its own falls through to these.
  objectives?: MapObjective[];
  // One layer per Main Task, keyed by MISSION ID. Absent means the map has no
  // task-specific authoring and every Task plays on the base.
  //
  // TRAP: these keys are mission ids. If a mission is ever re-keyed, every map
  // holding a layer for it is silently orphaned -- the same failure class as a
  // mis-keyed keyword override. mapeditor.test.mjs pins the keys against the
  // real mission list.
  tasks?: Record<string, TaskLayer>;
}

export function emptyCustomMap(): CustomMap {
  return { pieces: [], zones: [], deploy: { black: [], white: [] } };
}

// ---------- task layers (E2) ----------
//
// OTTO's design: one map holds a BASE (terrain, deployment, default zones) plus
// a LAYER PER TASK. Load "Castle", pick "Black Box: Fragment Recovery", and the
// editor shows that task's own zones and objective spots; multiplayer picking
// the same pair later resolves exactly what was authored.
//
// The "variables" this binds already existed: a mission card names its zones by
// NAME ("Bravo", "Charlie", ...) and taskItemsFor looks them up by name. A layer
// is precisely a per-(map, task) binding of those printed names to painted
// areas, which is why resolution can be a lookup and never a guess.

export type ObjectiveKind = 'blackbox' | 'terminal' | 'control';
export const OBJECTIVE_KINDS: ObjectiveKind[] = ['blackbox', 'terminal', 'control'];

// An explicit spot for a Task Item. `zone` is the ZONE NAME rather than an id:
// the name is what a mission card prints and what the resolver matches on, and
// it survives a zone being deleted and re-created with a fresh id.
//
// col/row are SUBCELLS, the same units every position in the game uses, so a
// Black Box can sit anywhere inside its zone rather than only at a Grid centre.
export interface MapObjective {
  kind: ObjectiveKind;
  zone: string;
  col: number;
  row: number;
}

export interface TaskLayer {
  zones?: CustomZone[];
  objectives?: MapObjective[];
  deploy?: CustomMap['deploy'];
}

const cells = (raw: unknown): { col: number; row: number }[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((c): c is { col: number; row: number } =>
      !!c && Number.isInteger((c as { col?: unknown }).col) && Number.isInteger((c as { row?: unknown }).row))
    .map((c) => ({ col: c.col, row: c.row }));

const zoneList = (raw: unknown): CustomZone[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((z): z is CustomZone => !!z && typeof (z as CustomZone).id === 'string' && typeof (z as CustomZone).name === 'string')
    .map((z) => ({ id: z.id, name: z.name, cells: cells(z.cells) }));

const objectiveList = (raw: unknown): MapObjective[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((o): o is MapObjective => {
      const x = o as Partial<MapObjective>;
      return !!o && typeof x.zone === 'string' && OBJECTIVE_KINDS.includes(x.kind as ObjectiveKind)
        && Number.isInteger(x.col) && Number.isInteger(x.row);
    })
    .map((o) => ({ kind: o.kind, zone: o.zone, col: o.col, row: o.row }));

function normaliseLayer(raw: unknown): TaskLayer {
  const o = (raw ?? {}) as Partial<TaskLayer>;
  const out: TaskLayer = {};
  // Each field is carried ONLY when the layer actually defines it: an absent
  // field means "fall through to the base", and writing an empty array here
  // would turn that into "this task deliberately has no zones", which is a
  // different and much worse answer.
  if (o.zones !== undefined) out.zones = zoneList(o.zones);
  if (o.objectives !== undefined) out.objectives = objectiveList(o.objectives);
  if (o.deploy !== undefined) {
    out.deploy = { black: cells(o.deploy?.black), white: cells(o.deploy?.white) };
  }
  return out;
}

// What a given task actually plays on. THE ONE RESOLVER: task layer, else the
// map's base, else (for zones) nothing, and the caller falls back to the
// shipped set. Everything that needs to answer "where is Bravo on this map for
// this task" must come through here rather than reimplementing the chain.
export function resolveLayer(map: CustomMap | null | undefined, missionId: string | null | undefined): {
  zones: CustomZone[];
  objectives: MapObjective[];
  deploy: CustomMap['deploy'];
  // Whether a layer for this task exists at all, so the editor can say
  // "not configured yet" rather than silently showing the base as if it were
  // the task's own.
  configured: boolean;
} {
  const base = map ?? emptyCustomMap();
  const layer = missionId ? base.tasks?.[missionId] : undefined;
  return {
    zones: layer?.zones ?? base.zones,
    objectives: layer?.objectives ?? base.objectives ?? [],
    deploy: layer?.deploy ?? base.deploy,
    configured: !!layer,
  };
}

// A grid ref ("D4") from a Large-Grid coordinate. The authoring side stores
// {col,row}; zones.json and everything downstream speak refs, so the conversion
// happens ONCE, here, at the boundary between the two.
//
// A-R covers the largest board we ship (18 Grids); see the parser note in
// data.ts, which this is the inverse of.
export function gridRefOf(col: number, row: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

// The zones a TABLE plays with for a given map and Main Task, in the shape
// zones.json ships. Returns null when the map authors none, so the caller keeps
// the shipped nine rather than being handed an empty board.
//
// THE ONE CONVERSION. Everything that needs "where is Bravo on this map for
// this Task" comes through resolveLayer + this, so the editor, the freeplay
// board and a remote seat can never disagree about the answer.
export function tableZonesFor(
  map: CustomMap | null | undefined,
  missionId: string | null | undefined,
): { id: string; name: string; cells: string[] }[] | null {
  const layer = resolveLayer(map, missionId);
  const painted = layer.zones.filter((z) => z.cells.length);
  if (!painted.length) return null;
  return painted.map((z) => ({
    id: z.id,
    name: z.name,
    cells: z.cells.map((c) => gridRefOf(c.col, c.row)),
  }));
}

// The Deployment Zones a table plays with for a map and Task, as grid refs.
// Null when the map paints none, so the caller keeps the printed shape.
export function tableDeployFor(
  map: CustomMap | null | undefined,
  missionId: string | null | undefined,
): { black: string[]; white: string[] } | null {
  const dep = resolveLayer(map, missionId).deploy;
  if (!dep.black.length && !dep.white.length) return null;
  return {
    black: dep.black.map((c) => gridRefOf(c.col, c.row)),
    white: dep.white.map((c) => gridRefOf(c.col, c.row)),
  };
}

function normalise(raw: unknown): CustomMap {
  if (Array.isArray(raw)) return { ...emptyCustomMap(), pieces: raw as TerrainPiece[] };
  const o = (raw ?? {}) as Partial<CustomMap>;
  const tasks: Record<string, TaskLayer> = {};
  for (const [id, layer] of Object.entries(o.tasks ?? {})) {
    if (typeof id === 'string' && id) tasks[id] = normaliseLayer(layer);
  }
  return {
    // Only 16 and 18 are carried; anything else (including absent, and
    // including a hand-edited number) reads as the printed board.
    ...(o.grids === 16 || o.grids === 18 ? { grids: o.grids } : {}),
    pieces: o.pieces ?? [],
    zones: zoneList(o.zones),
    deploy: { black: cells(o.deploy?.black), white: cells(o.deploy?.white) },
    // Absent stays absent, at both levels: a map with no task layers must not
    // grow an empty `tasks: {}` just by being loaded and saved.
    ...(o.objectives !== undefined ? { objectives: objectiveList(o.objectives) } : {}),
    ...(Object.keys(tasks).length ? { tasks } : {}),
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
