// THE MECH BUILDER, shared by the tabletop's Add > Mech tab (roster.ts) and the
// pad's Build a Mech panel. OTTO asked for the pad's builder to replace the
// board's first-generation dropdowns (2026-09-24), so this is ONE copy of the
// rows, the points, the faction rule, the legality check and the slot picker:
// the two tools can no longer drift apart.
//
// MARKUP, NOT DOM. The pad paints template strings and delegates every click
// off `data-act`; the tabletop mounts the same string and delegates the same
// attributes. The acts it emits:
//   build-slot   data-slot   a row: open the card browser for that slot
//   build-clear  data-slot   a filled row's ✕: empty the slot
//   build-rename             the name's Rename
//   card         data-id     a filled row's i: read the chosen card
// Each page supplies the cards a slot may take (its collection, its shelf) and
// what a pick does; the look and the rules live here. Styles: mechbuilder.css.
import type { Card, MechLoadout } from './types';
import { cardName, isDiscardCard, isModeFace, type GameData } from './data';
import { alertDialog, confirmDialog } from './dialog';
import { groupByFaction, openPartPicker } from './partpicker';

export type BuildSlot = { key: keyof MechLoadout; label: string; type: string };

export const BUILD_SLOTS: BuildSlot[] = [
  { key: 'torso', label: 'Torso', type: 'torso' },
  { key: 'chasis', label: 'Chassis', type: 'chasis' },
  { key: 'leftHand', label: 'Left arm', type: 'leftHand' },
  { key: 'rightHand', label: 'Right arm', type: 'rightHand' },
  { key: 'backpack', label: 'Backpack', type: 'backpack' },
  { key: 'pilot', label: 'Pilot', type: 'pilot' },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// The cards a slot may take before a page narrows them to its collection:
// the right category and type, alphabetical. A Discard Card is the flipped
// face of a Part you already own, and a zero-cost Mode face is a state a
// Harpoon shot puts you in, so neither is a build choice. Both are kept if
// already chosen, so an old save still shows what it holds. (Moved here from
// roster.ts: the pad offered both, the board never did.)
export function slotPool(data: GameData, slot: BuildSlot, chosen?: string): Card[] {
  return data.cards
    .filter((c) => (slot.key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === slot.type))
    .filter((c) => !isDiscardCard(c) || c.id === chosen)
    .filter((c) => !isModeFace(c) || c.id === chosen)
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
}

// Every faction the build draws on, THE PILOT INCLUDED. Pilots are
// faction-locked exactly like Parts: not in the rulebook, which reads the other
// way, but ratified from tournament practice (see the faction-legality notes).
// Dropping the pilot here is a regression, not a fix.
export function buildFactions(data: GameData, m: MechLoadout): { factions: string[]; unknown: number } {
  const seen = new Set<string>();
  let unknown = 0;
  for (const s of BUILD_SLOTS) {
    const id = m[s.key];
    const card = id ? data.byId.get(id) : undefined;
    if (!card) continue;
    const f = data.factionOf(card);
    if (f) seen.add(f);
    else unknown++;
  }
  return { factions: [...seen], unknown };
}

// The faction the build has committed to, or null while it is open (or mixed).
export function buildLockedFaction(data: GameData, m: MechLoadout): string | null {
  const { factions } = buildFactions(data, m);
  return factions.length === 1 ? factions[0] : null;
}

export function buildPoints(data: GameData, m: MechLoadout): number {
  return BUILD_SLOTS.reduce((n, s) => {
    const id = m[s.key];
    return n + (id ? (data.byId.get(id)?.score ?? 0) : 0);
  }, 0);
}

// The build rules, the same wherever a Mech is added, saved or edited. A
// missing core Part is refused (rulebook 2.2.2); a mixed faction is warned and
// may be taken anyway (warn, don't block - the house rule for legality).
export async function confirmLegalBuild(data: GameData, m: MechLoadout, confirmLabel: string): Promise<boolean> {
  const missing = [
    m.torso ? '' : 'a Torso',
    m.chasis ? '' : 'a Chassis',
    m.leftHand || m.rightHand ? '' : 'at least one Arm',
  ].filter(Boolean);
  if (missing.length) {
    await alertDialog({
      title: 'That mech is not legal yet',
      body: `A mech needs a Torso, a Chassis and at least one Arm (rulebook 2.2.2). Still to pick: ${missing.join(', ')}.`,
    });
    return false;
  }
  const { factions } = buildFactions(data, m);
  if (factions.length > 1) {
    return confirmDialog({
      title: 'That mech mixes factions',
      body: `It uses ${factions.join(' and ')} parts. Rulebook 5.1 says a Mech can only be composed of Parts from a single faction, so this build is not legal.`,
      confirmLabel,
      cancelLabel: 'Let me fix it',
      danger: true,
    });
  }
  return true;
}

// The builder as markup: the name and its Rename, the faction and the points,
// and one card row per slot. `note` rides after the faction ("for P1").
export function mechBuilderHtml(data: GameData, m: MechLoadout, view: { name: string; note?: string }): string {
  const { factions } = buildFactions(data, m);
  const mixed = factions.length > 1;
  const faction = factions.length ? factions.join(' + ') : 'any faction';
  const rows = BUILD_SLOTS.map((s) => {
    const id = m[s.key];
    const card = id ? data.byId.get(id) : undefined;
    const f = card ? data.factionOf(card) : null;
    const art = !card ? ''
      : s.key === 'pilot'
        ? `<span class="mb-thumb" data-portrait="${esc(card.id)}"></span>`
        : `<span class="mb-art" data-partart="${esc(card.id)}" aria-hidden="true"></span>`;
    return `<div class="mb-rowwrap">
      <button type="button" class="mb-row${s.key === 'pilot' ? ' mb-pilot' : ''}"${f ? ` data-fac="${esc(f)}"` : ''} data-act="build-slot" data-slot="${s.key}">
        ${art}
        <span class="mb-slot">${s.label}</span>
        <span class="mb-part${card ? '' : ' mb-empty'}">${card ? esc(cardName(card)) : 'empty'}</span>
        <span class="mb-cost">${card?.score ? `${card.score}p` : ''}</span>
      </button>
      ${card ? `<button type="button" class="mb-info" data-act="card" data-id="${esc(card.id)}" aria-label="Read ${esc(cardName(card))}">i</button>
      <button type="button" class="ui-x mb-clear" data-act="build-clear" data-slot="${s.key}" aria-label="Take ${esc(cardName(card))} off">✕</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="mb">
    <div class="mb-head">
      <span class="mb-name">${esc(view.name)}</span>
      <button type="button" class="mb-chip" data-act="build-rename">Rename</button>
    </div>
    <div class="mb-line${mixed ? ' bad' : ''}">
      <span>${esc(faction)}${view.note ? ` · ${esc(view.note)}` : ''}</span>
      <span class="mb-pts">${buildPoints(data, m)}<i>p</i></span>
    </div>
    ${rows}
  </div>`;
}

// The name a build shows before one is set: its Torso's card name.
export function buildDefaultName(data: GameData, m: MechLoadout): string {
  const torso = m.torso ? data.byId.get(m.torso) : undefined;
  return torso ? cardName(torso) : '';
}

// One slot's card browser. The page passes the cards on offer (slotPool,
// narrowed by its collection or shelf) and what a pick does. The faction lock
// covers every slot, pilot included, for the reason buildFactions gives.
export function openMechSlot(o: {
  data: GameData;
  loadout: MechLoadout;
  slot: BuildSlot;
  cards: Card[];
  badge?: (c: Card) => string;
  remaining?: (c: Card) => number | null;
  actionLabel?: string;
  onPick: (card: Card) => void;
}): void {
  openPartPicker({
    data: o.data,
    slotLabel: o.slot.label,
    groups: groupByFaction(o.data, o.cards),
    chosen: o.loadout[o.slot.key],
    lockedFaction: buildLockedFaction(o.data, o.loadout),
    ...(o.badge ? { badge: o.badge } : {}),
    ...(o.remaining ? { remaining: o.remaining } : {}),
    actions: [{ label: o.actionLabel ?? `Set ${o.slot.label}`, run: o.onPick }],
  });
}
