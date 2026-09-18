import type { Card, ImportedSquad, MechLoadout, PartSlot } from './types';

const SLOTS: PartSlot[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];

const PLACEHOLDER_NAME = /^\s*(?:new\s+mech|new\s+unit|untitled|mech|unnamed)\s*\d*\s*$/i;

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
  const importedMechs = mechs.map((m) => {
    const mech = m as Record<string, unknown>;
    const parts = (mech.parts ?? mech) as Record<string, unknown>;
    const loadout: MechLoadout = {};
    for (const slot of SLOTS) loadout[slot] = check(refId(parts[slot]));
    loadout.pilot = check(refId(mech.pilot));
    const raw = typeof mech.name === 'string' ? mech.name.trim() : '';
    const name = raw && !PLACEHOLDER_NAME.test(raw) ? raw : undefined;
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

  // Only real Tactics Cards survive: setTactics refuses anything else, and a
  // file is the one source a player cannot easily inspect before it applies.
  // The builder site writes the hand as `tacticCards`; our own exports write
  // `tactics`. Read from the live bundle 2026-09-18: the site has never used
  // the second name, so a builder squad arrived with no hand at all.
  const hand = Array.isArray(team.tactics) ? team.tactics : Array.isArray(team.tacticCards) ? team.tacticCards : [];
  const handIds = hand.map((t) => refId(t)).filter((id): id is string => !!id);
  // The builder can export with the hand MASKED: every card replaced by the
  // same placeholder so an opponent cannot read it off the image. A hand may
  // hold one copy of a card (FAQ P2), so a repeat can only be that mask - and
  // importing it would seat a card the player never chose. The hand is left
  // empty instead, for the player to set.
  const masked = new Set(handIds).size !== handIds.length;
  const tactics = (masked ? [] : hand)
    .map((t) => check(refId(t)))
    .filter((id): id is string => !!id && byId.get(id)?.category === 'tactics_or_upgrade');

  return {
    name: typeof team.name === 'string' ? team.name : 'Imported squad',
    faction: typeof team.faction === 'string' ? team.faction : undefined,
    mechs: importedMechs.filter((m) => m.loadout.torso || m.loadout.chasis),
    drones,
    tactics,
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
