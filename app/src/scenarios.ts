import type { GameData } from './data';
import { dataUrl } from './data';
import { saveCustomMap } from './mapeditor';
import type { Facing, GameState, Marker, MechLoadout, Side, TerrainPiece, Token } from './types';
import { makeDroneToken, makeMechToken } from './units';

export interface ScenarioUnit {
  kind: 'mech' | 'drone' | 'projectile';
  name: string;
  grid: string;
  facing?: string;
  torso?: string | null;
  chasis?: string | null;
  leftHand?: string | null;
  rightHand?: string | null;
  backpack?: string | null;
  pilot?: string | null;
  cardId?: string | null;
}

export interface ScenarioTerrain {
  type: 'building' | 'high_wall' | 'low_wall' | 'container2' | 'container1';
  grid: string;
  orientation?: 'vertical' | 'horizontal';
}

export interface Scenario {
  id: string;
  name: string;
  subtitle?: string;
  source?: string;
  rounds?: number;
  description?: string;
  sides: Record<Side, { name: string; units: ScenarioUnit[] }>;
  terrain: ScenarioTerrain[];
  markers: { kind: string; grid: string }[];
  scoring?: { points: string; name: string; note?: string }[];
  simplifications?: string[];
  notes?: string[];
  unmatched?: string[];
}

export async function loadScenarios(): Promise<Scenario[]> {
  try {
    const r = await fetch(dataUrl('scenarios.json'));
    if (!r.ok) return [];
    return (await r.json()) as Scenario[];
  } catch {
    return [];
  }
}

export function parseGrid(ref: string): { c: number; r: number } | null {
  const m = /^([A-La-l])\s*(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  const c = m[1].toUpperCase().charCodeAt(0) - 65;
  const r = Number(m[2]) - 1;
  if (c < 0 || c > 11 || r < 0 || r > 11) return null;
  return { c, r };
}

const FACING: Record<string, Facing> = { N: 0, E: 1, S: 2, W: 3 };

function terrainPieces(list: ScenarioTerrain[]): TerrainPiece[] {
  let n = 1;
  const out: TerrainPiece[] = [];
  for (const t of list) {
    const g = parseGrid(t.grid);
    if (!g) continue;
    const bc = g.c * 3;
    const br = g.r * 3;
    const cells: { col: number; row: number }[] = [];
    const vertical = t.orientation !== 'horizontal';
    if (t.type === 'building') {
      for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) cells.push({ col: bc + dc, row: br + dr });
    } else if (t.type === 'high_wall' || t.type === 'low_wall') {
      for (let i = 0; i < 3; i++) cells.push({ col: bc + (vertical ? 1 : i), row: br + (vertical ? i : 1) });
    } else if (t.type === 'container2') {
      for (let i = 0; i < 2; i++) cells.push({ col: bc + (vertical ? 1 : i), row: br + (vertical ? i : 1) });
    } else {
      cells.push({ col: bc + 1, row: br + 1 });
    }
    out.push({
      id: `scn_${t.type}_${n++}_${t.grid}`,
      type: t.type === 'container2' || t.type === 'container1' ? 'container' : t.type,
      subCells: cells,
      height: t.type === 'building' || t.type === 'high_wall' ? 3 : t.type === 'low_wall' ? 2 : 1,
      blocksLos: t.type === 'building' || t.type === 'high_wall',
      providesProtection: t.type !== 'container2' && t.type !== 'container1',
      isFragile: t.type === 'container2' || t.type === 'container1',
    });
  }
  return out;
}

export interface LoadResult {
  tokens: Token[];
  markers: Marker[];
  mapKey: string;
  warnings: string[];
}

export function instantiateScenario(scn: Scenario, state: GameState, data: GameData): LoadResult {
  const warnings: string[] = [...(scn.unmatched ?? []).map((u) => `unmatched card: ${u}`)];
  const tokens: Token[] = [];

  for (const side of ['blue', 'red'] as Side[]) {
    for (const u of scn.sides[side]?.units ?? []) {
      const g = parseGrid(u.grid);
      if (!g) {
        warnings.push(`${u.name}: bad grid "${u.grid}"`);
        continue;
      }
      const facing = FACING[(u.facing ?? (side === 'blue' ? 'S' : 'N')).toUpperCase()] ?? 0;
      if (u.kind === 'mech') {
        const loadout: MechLoadout = {
          torso: u.torso ?? undefined,
          chasis: u.chasis ?? undefined,
          leftHand: u.leftHand ?? undefined,
          rightHand: u.rightHand ?? undefined,
          backpack: u.backpack ?? undefined,
          pilot: u.pilot ?? undefined,
        };
        const tok = makeMechToken(state, data, loadout, side, u.name);
        tokens.push({ ...tok, col: g.c * 3, row: g.r * 3, facing });
      } else {
        const card = u.cardId ? data.byId.get(u.cardId) : undefined;
        if (!card) {
          warnings.push(`${u.name}: card ${u.cardId} not found`);
          continue;
        }
        const tok = makeDroneToken(state, data, card, side);
        const off = tok.size === 3 ? 0 : tok.size === 2 ? 0 : 1;
        tokens.push({ ...tok, col: g.c * 3 + off, row: g.r * 3 + off, facing });
      }
    }
  }

  const markers: Marker[] = [];
  for (const m of scn.markers ?? []) {
    const g = parseGrid(m.grid);
    if (g) markers.push({ kind: m.kind, col: g.c, row: g.r });
  }

  const mapName = `[scn] ${scn.name}`;
  saveCustomMap(mapName, terrainPieces(scn.terrain ?? []));

  return { tokens, markers, mapKey: `custom:${mapName}`, warnings };
}
