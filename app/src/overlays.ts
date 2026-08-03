import type { BoardDeployment, BoardZone } from './board';
import { parseGridRef, type GameData } from './data';

// The printed zone and deployment shapes, resolved from a zoneSet id. Shared
// by the board page and the Match Centre so both draw the same battlefield.
// Custom painted maps stay with the board page, which owns their storage.

export function printedZones(data: GameData, ids?: string[]): BoardZone[] {
  const pool = ids ? data.zoneData.zones.filter((z) => ids.includes(z.id)) : data.zoneData.zones;
  return pool
    .map((z) => ({ name: z.name, cells: z.cells.map(parseGridRef).filter(Boolean) as { col: number; row: number }[] }))
    .filter((z) => z.cells.length);
}

export function printedDeployment(data: GameData, id: string | null | undefined): BoardDeployment | null {
  const def = id ? data.zoneData.deployments.find((d) => d.id === id) : undefined;
  if (!def) return null;
  const box = (from: string, to: string, label: string) => {
    const a = parseGridRef(from);
    const b = parseGridRef(to);
    if (!a || !b) return undefined;
    const rect = {
      col: Math.min(a.col, b.col),
      row: Math.min(a.row, b.row),
      cols: Math.abs(b.col - a.col) + 1,
      rows: Math.abs(b.row - a.row) + 1,
    };
    return { rect, label: `${label} ${rect.rows}x${rect.cols}` };
  };
  return { black: box(def.black.from, def.black.to, 'BLACK'), white: box(def.white.from, def.white.to, 'WHITE') };
}

export function resolveZoneSetData(data: GameData, id: string): { zones: BoardZone[]; deploy: BoardDeployment | null } {
  if (!id || id.startsWith('custom:')) return { zones: [], deploy: null };
  if (id.startsWith('mission:')) {
    const m = data.missions.cards.find((c) => c.id === id.slice(8));
    if (!m) return { zones: [], deploy: null };
    return {
      zones: printedZones(data, m.zones?.map((z) => z.toLowerCase()) ?? []),
      deploy: printedDeployment(data, data.zoneData.missionDeployment[m.id]),
    };
  }
  const spec = id.startsWith('board:') ? id.slice(6) : '';
  const parts = spec.split('+');
  return {
    zones: parts.includes('zones') ? printedZones(data) : [],
    deploy: printedDeployment(data, parts.find((p) => p === 'corners' || p === 'strips')),
  };
}
