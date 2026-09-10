// What is IN a box, and two boxes side by side - shared by the tabletop's
// inventory dialog and the reference's Boxes tab.
//
// These lived inside the Inventory class. The reference then needed the same
// two things players had been asking for at the table - "only the cards this
// box alone gives me" and "these two boxes against each other" - and a second
// copy of the row would have let the two pages disagree about the same box,
// which is precisely the bug that made OTTO count Mire Cores. So the rows,
// the exclusivity rule and the comparison are here once, and each page adds
// its own chrome around them: the inventory its flyout and owned counts, the
// reference its detail sheet and card links.
import type { Card, LangText } from './types';
import { boxCoverUrl, isListedBox, traitName } from './data';
import { expandGlyphs } from './glyphs';

export interface BoxInfo {
  key: string;
  id: number;
  name: LangText;
  faction?: string[];
  hasImage?: boolean;
  released?: boolean;
  product?: string;
  // Declared so isListedBox can actually read it here. The objects handed in are
  // data.boxes itself, so the flag is present at runtime either way, but leaving
  // it off the interface hides that from the compiler.
  hidden?: boolean;
}

export const FACTION_SHORT: Record<string, string> = {
  RDL: 'RDL',
  UN: 'UN',
  GOF: 'GoF',
  PD: 'PD',
  COLLABORATION: 'Collab',
};

const SLOT_SHORT: Record<string, string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'L.Arm',
  rightHand: 'R.Arm',
  backpack: 'Pack',
  small: 'Drone',
  medium: 'Drone',
  large: 'Drone',
};

const CATEGORY_SHORT: Record<string, string> = {
  pilot: 'Pilot',
  drone: 'Drone',
  projectile: 'Proj',
  tactics_or_upgrade: 'Tactic',
  mech_part: 'Part',
};

const SLOT_ORDER = ['Torso', 'Chassis', 'L.Arm', 'R.Arm', 'Pack', 'Drone', 'Proj', 'Pilot', 'Tactic', 'Part'];

// Two box names carry double quotes - LAB-"Vigilant" Autocannon & MG type and
// its Bombing sibling - and several carry an ampersand. Interpolated raw, the
// quote closed the attribute early. Everything from the data is escaped, and
// the quote has to be escaped too, not just the three characters text needs.
export const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function boxName(b: BoxInfo | undefined, key: string): string {
  return b?.name.en || b?.name.zh || key;
}

export interface BoxItem {
  id: string;
  slot: string;
  name: string;
  n: number;
  trait?: string;
  traitName?: string;
}

// Every card a box ships, in slot order then by name, with the count of
// copies and - for a pilot - the trait it is chosen for.
export function boxItems(cards: readonly Card[], key: string): BoxItem[] {
  const out: BoxItem[] = [];
  for (const c of cards) {
    const entry = (c.containedIn ?? []).find((e) => e.box === key);
    if (!entry) continue;
    // Only pilots, and the NAME leads the line: the publisher's English is
    // merged in at load time, so the short label a player actually compares
    // by is available and traitName() supplies it.
    //
    // A pilot with no trait NAME still carries a traitDescription, but it is
    // flavour - "A new Scout from Test and Evaluation Squadron 066" - and the
    // generic Scouts and Shock Troops all have one. Printing that as a trait
    // would fill the comparison with lines that are not rules at all, so the
    // name is what decides, exactly as the reference's detail view does.
    const named = c.category === 'pilot' && (c.trait ?? '').trim();
    const trait = named ? (c.traitDescription?.en ?? '').trim().replace(/^[•·]\s*/, '') : '';
    out.push({
      id: c.id,
      slot: SLOT_SHORT[c.type ?? ''] ?? CATEGORY_SHORT[c.category] ?? '',
      name: c.name.en || c.name.zh || c.id,
      n: entry.quantityPerBox,
      trait: trait || undefined,
      traitName: named ? traitName(c) || undefined : undefined,
    });
  }
  const rank = (s: string) => {
    const i = SLOT_ORDER.indexOf(s);
    return i < 0 ? SLOT_ORDER.length : i;
  };
  return out.sort((a, b) => rank(a.slot) - rank(b.slot) || a.name.localeCompare(b.name));
}

// Every box a card ships in, so a row can say whether it is unique to the box
// being looked at or turns up elsewhere too. Cards with no box data at all are
// excluded from both sides rather than guessed at. Unlisted boxes drop out
// too: "exclusive" has to mean among boxes somebody can actually buy, or a
// card whose only other home is the Kickstarter pack reads as shared when in
// practice this box is the only way to get it.
export function boxesOf(cards: readonly Card[], boxes: readonly BoxInfo[], id: string): string[] {
  const c = cards.find((x) => x.id === id);
  const listed = new Set(boxes.filter(isListedBox).map((b) => b.key));
  return (c?.containedIn ?? []).map((e) => e.box).filter((b) => listed.has(b));
}

// The rule behind the "Exclusive cards" tick, in one place: a card is
// exclusive to a box when that box is the only listed one that ships it.
export function isExclusiveTo(cards: readonly Card[], boxes: readonly BoxInfo[], id: string, key: string): boolean {
  const all = boxesOf(cards, boxes, id);
  return all.length === 1 && all[0] === key;
}

export function compareRows(cards: readonly Card[], boxes: readonly BoxInfo[], key: string, other: string, exclusiveOnly: boolean) {
  return boxItems(cards, key)
    .map((i) => {
      const all = boxesOf(cards, boxes, i.id);
      return { ...i, elsewhere: all.filter((b) => b !== key), inOther: all.includes(other) };
    })
    .filter((i) => !exclusiveOnly || i.elsewhere.length === 0);
}

// How many of the first box's cards the second also ships.
export function sharedCount(cards: readonly Card[], boxes: readonly BoxInfo[], a: string, b: string): number {
  return boxItems(cards, a).filter((i) => boxesOf(cards, boxes, i.id).includes(b)).length;
}

// The inventory's own checkbox, so the reference's tick is the same tick.
export function exclusiveToggle(id: string, checked: boolean, extraClass = ''): string {
  return `<label class="inv-filter${extraClass ? ` ${extraClass}` : ''}"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="inv-tick"></span> Exclusive cards</label>`;
}

export interface CompareChrome {
  // The control that picks a side's box, drawn by the page: the inventory's
  // and the reference's are the same <select>, but the pool behind it is
  // the page's to decide.
  picker: (side: 0 | 1) => string;
  // The attribute a row carries so the page can open the card: the board
  // hovers a preview off data-tip-card, the reference opens a sheet off
  // data-card.
  rowAttr: (id: string) => string;
  // How many copies the player owns, when the page keeps that; the tally
  // says nothing about ownership otherwise.
  owned?: (key: string) => number | undefined;
}

// Two boxes side by side: covers on the outside, contents down the middle.
// Deliberately states facts only - counts, which cards overlap, whether the
// box is sold - and draws no conclusions from them.
export function compareGrid(
  cards: readonly Card[],
  boxes: readonly BoxInfo[],
  cmp: readonly [string, string],
  exclusiveOnly: boolean,
  chrome: CompareChrome,
): string {
  const column = (side: 0 | 1) => {
    const key = cmp[side];
    const box = boxes.find((b) => b.key === key);
    const rows = compareRows(cards, boxes, key, cmp[side ? 0 : 1], exclusiveOnly);
    const all = boxItems(cards, key);
    const uniq = all.filter((i) => boxesOf(cards, boxes, i.id).length === 1).length;
    const sold = box?.released === false ? '<span class="inv-cmp-tag">not currently sold</span>' : '';
    const owned = chrome.owned?.(key);
    return `<div class="inv-cmp-col">
        <div class="inv-cmp-head">${chrome.picker(side)}${sold}</div>
        ${box?.hasImage ? `<div class="inv-cmp-cover"><img src="${boxCoverUrl(box.id)}" alt="" loading="lazy" onerror="this.closest('.inv-cmp-cover').remove()"></div>` : ''}
        <div class="inv-cmp-tally">${all.length} card${all.length === 1 ? '' : 's'} · ${all.reduce((s, i) => s + i.n, 0)} pieces · ${uniq} in no other box${owned === undefined ? '' : ` · you own ${owned}`}</div>
        <ul class="inv-parts inv-cmp-list">${
          rows.length
            ? rows
                .map(
                  (i) =>
                    `<li ${chrome.rowAttr(i.id)}${i.inOther ? ' class="shared"' : ''}><span class="ip-slot">${i.slot}</span><span class="ip-name">${esc(i.name)}</span>${
                      // HOW MANY COPIES, same rule as the contents panel beside
                      // it. Without this a box holding four Mire Cores read as
                      // holding one, and the two panels disagreed about the
                      // same box - which is how OTTO found it.
                      i.n > 1 ? `<span class="ip-n">×${i.n}</span>` : ''
                    }${
                      i.inOther ? '<span class="ip-both">both</span>' : i.elsewhere.length ? `<span class="ip-else">+${i.elsewhere.length}</span>` : ''
                    }${
                      // A pilot is chosen for its trait, so comparing two boxes'
                      // pilots means comparing traits. Printed under the name in
                      // both columns. The publisher's trait NAME leads it,
                      // because that is the handle two columns are actually
                      // scanned by; the rule follows.
                      i.trait || i.traitName
                        ? `<span class="ip-trait">${i.traitName ? `<b>${esc(i.traitName)}</b>${i.trait ? ' ' : ''}` : ''}${expandGlyphs(esc(i.trait ?? ''))}</span>`
                        : ''
                    }</li>`,
                )
                .join('')
            : '<li class="dim">Nothing to show with this filter.</li>'
        }</ul>
      </div>`;
  };
  return `<div class="inv-cmp-grid">${column(0)}${column(1)}</div>`;
}

// The <select> both pages use to pick a side's box.
export function boxPicker(pool: readonly BoxInfo[], side: 0 | 1, chosen: string): string {
  return `<select class="inv-cmp-pick" data-side="${side}" aria-label="Box ${side + 1}">${pool
    .map((b) => `<option value="${esc(b.key)}"${chosen === b.key ? ' selected' : ''}>${esc(boxName(b, b.key))}</option>`)
    .join('')}</select>`;
}
