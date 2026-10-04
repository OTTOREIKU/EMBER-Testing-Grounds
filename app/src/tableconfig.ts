// WHAT A TABLE IS CONFIGURED WITH for a battlefield and a Main Task.
//
// A Main Task is more than its id: its Tactical Zones on this map, the
// Deployment Zones, and the Task ITEMS it puts on the table (the control dials
// of an Occupation, the Black Boxes, the Terminals). The engine does not work
// those out: the page computes them and hands them over inside configureTable,
// so both seats hold the identical set (tasks.ts taskItemsFor). The Match
// Centre's lobby did that inline, once for a map picked and once for a Task
// picked. A game against the computer builds its table with no lobby, and a
// table built without them plays a Task that can never score (an Occupation
// with no control dials pays nothing all game: found by the computer games,
// 2026-10-01). So the two payloads live here, the lobby sends them, and so
// does anything else that sets a table up.
import type { Command } from './commands';
import type { GameData } from './data';
import { resolveLayer, tableDeployFor, tableZonesFor } from './mapeditor';
import { taskItemsFor } from './tasks';
import { gridsOf } from './types';

type Configure = Extract<Command, { kind: 'configureTable' }>;

// A battlefield picked, with the Main Task already on the table (or none).
export function mapConfig(data: GameData, mapId: string, missionId: string | null | undefined): Pick<Configure, 'map' | 'grids' | 'zones' | 'deployZones' | 'tasks'> {
  const doc = data.boardMaps?.find((m) => m.id === mapId) ?? null;
  const m = missionId ? data.missions.cards.find((x) => x.id === missionId) : undefined;
  // The zones ride with the map: a Task already chosen has to be
  // re-resolved against the new battlefield, or it would keep scoring the
  // old one's areas. Both seats read the same shipped document, so both
  // land on the identical answer.
  return {
    map: mapId, grids: gridsOf(doc),
    zones: m ? tableZonesFor(doc, m.id) : null,
    deployZones: tableDeployFor(doc, m?.id ?? null),
    ...(m ? { tasks: taskItemsFor(tableZonesFor(doc, m.id) ?? data.zoneData.zones, m, resolveLayer(doc, m.id).objectives) } : {}),
  };
}

// A Main Task picked (or cleared), on the battlefield already on the table.
export function missionConfig(data: GameData, mapId: string, missionId: string | null | undefined): Pick<Configure, 'mission' | 'zones' | 'deployZones' | 'tasks' | 'zoneSet'> {
  const m = missionId ? data.missions.cards.find((x) => x.id === missionId) : undefined;
  // Resolved against the SHIPPED document for the chosen map, so an
  // authored map's own zones and objective spots are what this table plays
  // with. A `custom:` map is never offered here, so there is no storage to
  // read and both seats compute the identical set.
  const doc = data.boardMaps?.find((x) => x.id === mapId) ?? null;
  const zones = m ? tableZonesFor(doc, m.id) : null;
  return {
    mission: m ? m.id : null,
    zones,
    // See the note in main.ts: the Deployment Zones survive a Task being
    // cleared, because they belong to the battlefield rather than the Task.
    deployZones: tableDeployFor(doc, m?.id ?? null),
    tasks: m ? taskItemsFor(zones ?? data.zoneData.zones, m, resolveLayer(doc, m.id).objectives) : null,
    zoneSet: m ? `mission:${m.id}` : '',
  };
}
