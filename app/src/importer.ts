import type { Card, ImportedSquad, MechLoadout, PartSlot } from './types';

const SLOTS: PartSlot[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];

function refId(x: unknown): string | undefined {
  if (!x) return undefined;
  if (typeof x === 'string') return x;
  if (typeof x === 'object' && 'id' in (x as object)) return String((x as { id: unknown }).id);
  return undefined;
}

export function parseSquadJson(raw: unknown, byId: Map<string, Card>): ImportedSquad {
  const team = raw as Record<string, unknown>;
  const unknownIds: string[] = [];
  const check = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    if (!byId.has(id)) {
      unknownIds.push(id);
      return undefined;
    }
    return id;
  };

  const mechs = Array.isArray(team.mechs) ? team.mechs : [];
  const importedMechs = mechs.map((m, i) => {
    const mech = m as Record<string, unknown>;
    const parts = (mech.parts ?? mech) as Record<string, unknown>;
    const loadout: MechLoadout = {};
    for (const slot of SLOTS) loadout[slot] = check(refId(parts[slot]));
    loadout.pilot = check(refId(mech.pilot));
    const name =
      typeof mech.name === 'string' && mech.name
        ? mech.name
        : `Mech ${i + 1}`;
    return { name, loadout };
  });

  const drones = (Array.isArray(team.drones) ? team.drones : [])
    .map((d) => {
      const id = check(refId(d));
      if (!id) return null;
      const backpack = check(refId((d as Record<string, unknown>).backpack));
      return { cardId: id, backpack };
    })
    .filter((x): x is { cardId: string; backpack: string | undefined } => !!x);

  return {
    name: typeof team.name === 'string' ? team.name : 'Imported squad',
    faction: typeof team.faction === 'string' ? team.faction : undefined,
    mechs: importedMechs.filter((m) => m.loadout.torso || m.loadout.chasis),
    drones,
    unknownIds,
  };
}

export function extractTeamDataFromPng(bytes: Uint8Array): unknown | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const data = bytes.subarray(off + 8, off + 8 + len);
    const zero = data.indexOf(0);
    if (zero > 0 && dec.decode(data.subarray(0, zero)) === 'TeamData') {
      try {
        return JSON.parse(dec.decode(data.subarray(zero + 1)));
      } catch {
        return null;
      }
    }
    off += 12 + len;
  }
  return null;
}

export async function importSquadFile(file: File, byId: Map<string, Card>): Promise<ImportedSquad> {
  if (file.name.toLowerCase().endsWith('.png')) {
    const data = extractTeamDataFromPng(new Uint8Array(await file.arrayBuffer()));
    if (!data) throw new Error('No TeamData found in this PNG (is it a builder squad image?)');
    return parseSquadJson(data, byId);
  }
  return parseSquadJson(JSON.parse(await file.text()), byId);
}
