import { barcodeSvg } from './barcode';
import './reference.css';
import './ui.css';
import { actionIconUrl, battlefieldCardUrl, boxCoverUrl, cardName, environmentImageUrl, HELP_CARDS, helpCardUrl, TOKEN_PRINT, tokenPrintUrl, factionArtUrl, FACTION_LABEL, isListedBox, loadData, mechPartUrl, missionImageUrl, portraitUrl, secondaryImageUrl, statIconIsPlated, statIconUrl, tabImageUrl, traitName, zeroCostReason, type BoxDef, type EnvironmentCard, type FactionDef, type GameData, type KeywordDef } from './data';
import { mountCardImage, mountCardImageCopy, preloadCardImages, warmAllImagesWhenIdle, watchImageFallbacks } from './images';
import { runFirstVisitPreload } from './preload';
import { watchForUpdates } from './updates';
import { SHAPE_NOTE, STATUSES, TIMINGS, type Card, type StatusDef, type TerrainMap } from './types';
import { registerOffline } from './offline';
import { costLabel, LENGTH_NAME, lengthOf, TICK_COST, timingOf } from './ticks';
import { diceRow, maskGlyphs, tickCapsule } from './glyphs';
import { iconSvg } from './dice';
import { linkIcon } from './icons';
import { cardRow, currentSeason, dieEntries, esc, fillPortraits, keywordCard, kwLabel, linkKeywords, matchDie, mechBlocks, rulesTab, sheetHtml, sheetLabel, SLOT_LABEL, SPEED_MARK, useCardData } from './refcards';
import { found, matchCard, matchKeyword, matchMechanic, matchMission, matchPhase, matchSeason, matchSecondary, matchStance, matchStatus, matchTiming, nmCard, nmKeyword, nmMechanic, nmMission, nmPlay, nmSeason, nmSecondary, nmStatus, norm, rank } from './refsearch';
import { installDiagnostics } from './diagnostics';
import { boxPicker, compareGrid, exclusiveToggle, isExclusiveTo, sharedCount } from './boxcompare';
import { applyChangelogFilter, decorateSheetHead, holdDetailHeight, revealLog, runSheetClick, runSheetFocus, runSheetInput, runSheetKey, showDetailTab, type SheetNav } from './refsheet';
import type { ReportCategory } from './report';
import { openReferenceReport } from './reportui';
// FIRST, before anything else in this module runs. A net that is installed
// after the thing it is meant to catch is not a net.
installDiagnostics(window);

type Tab = 'keywords' | 'parts' | 'units' | 'pilots' | 'tactics' | 'boxes' | 'factions' | 'missions' | 'battlefield' | 'rules';

interface Facet {
  id: string;
  label: string;
  match: (c: Card) => boolean;
}

const PART_FACETS: Facet[] = [
  { id: 'torso', label: 'Torso', match: (c) => c.type === 'torso' },
  { id: 'chasis', label: 'Chassis', match: (c) => c.type === 'chasis' },
  { id: 'leftHand', label: 'Left arm', match: (c) => c.type === 'leftHand' },
  { id: 'rightHand', label: 'Right arm', match: (c) => c.type === 'rightHand' },
  { id: 'backpack', label: 'Backpack', match: (c) => c.type === 'backpack' },
];

const UNIT_FACETS: Facet[] = [
  { id: 'drone', label: 'Drones', match: (c) => c.category === 'drone' },
  { id: 'projectile', label: 'Projectiles', match: (c) => c.category === 'projectile' },
  { id: 'small', label: 'Small', match: (c) => c.type === 'small' },
  { id: 'medium', label: 'Medium', match: (c) => c.type === 'medium' },
  { id: 'large', label: 'Large', match: (c) => c.type === 'large' },
];

const FACTION_ORDER = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'];

function factionFacets(pool: Card[]): Facet[] {
  const present = new Set<string>();
  for (const c of pool) {
    const f = data.factionOf(c);
    if (f) present.add(f);
  }
  const known = FACTION_ORDER.filter((f) => present.has(f));
  const rest = [...present].filter((f) => !FACTION_ORDER.includes(f)).sort();
  return [...known, ...rest].map((f) => ({
    id: f,
    label: FACTION_LABEL[f] ?? f,
    match: (c: Card) => data.factionOf(c) === f,
  }));
}

function facetsFor(t: Tab): Facet[] {
  if (t === 'parts') return PART_FACETS;
  if (t === 'units') return UNIT_FACETS;
  return [];
}

let data: GameData;
let tab: Tab = 'keywords';
let query = '';
// A fresh search casts across every tab at once; picking a tab narrows it.
// Cleared by tapping any tab, reset by the next search that starts from empty.
let allMode = true;
const facetChoice: Partial<Record<Tab, string>> = {};
const factionChoice: Partial<Record<Tab, string>> = {};
let rulesSection: string | undefined;
// The Boxes tab's two doors, asked for at the table. `boxExclusive` is the
// inventory's own "Exclusive cards" tick: on a box's sheet it keeps only the
// cards no other listed box ships, and on the comparison it does the same to
// both columns. `cmpPair` is which two boxes are being compared.
let boxExclusive = false;
const cmpPair: [string, string] = ['', ''];

const body = () => document.getElementById('ref-body')!;


// ---------- boxes ----------

const BOX_GROUPS: { label: string; match: (c: Card) => boolean }[] = [
  { label: 'Torso', match: (c) => c.type === 'torso' },
  { label: 'Chassis', match: (c) => c.type === 'chasis' },
  { label: 'Left arm', match: (c) => c.type === 'leftHand' },
  { label: 'Right arm', match: (c) => c.type === 'rightHand' },
  { label: 'Backpack', match: (c) => c.type === 'backpack' },
  { label: 'Pilots', match: (c) => c.category === 'pilot' },
  { label: 'Drones', match: (c) => c.category === 'drone' },
  { label: 'Projectiles', match: (c) => c.category === 'projectile' },
  { label: 'Tactics', match: (c) => c.category === 'tactics_or_upgrade' },
];

// quantityPerBox 0 means the card ships with the box without being a counted
// copy: Discard Cards sit under their parent Part Card (4.17), and alternate
// modes such as White Dwarf's Cruise Mode are the same physical card. They are
// in the box, so they are listed, just never counted as extra copies.
function boxContents(key: string): { card: Card; n: number; discardOf?: string }[] {
  return data.cards
    .map((card) => ({ card, entry: (card.containedIn ?? []).find((e) => e.box === key) }))
    .filter((x) => !!x.entry)
    .map((x) => ({ card: x.card, n: x.entry!.quantityPerBox ?? 0 }));
}

function boxCardCount(key: string): { cards: number; pieces: number } {
  const items = boxContents(key);
  return { cards: items.length, pieces: items.reduce((s, i) => s + i.n, 0) };
}

function boxDetail(key: string): string | null {
  const box = data.boxes.find((b) => b.key === key);
  if (!box) return null;
  const listed = data.boxes.filter(isListedBox);
  const all = boxContents(key);
  const exclusive = all.filter((i) => isExclusiveTo(data.cards, listed, i.card.id, key));
  const items = boxExclusive ? exclusive : all;
  const { cards, pieces } = boxCardCount(key);
  const used = new Set<string>();
  const groups = BOX_GROUPS.map((g) => {
    const hit = items.filter((i) => !used.has(i.card.id) && g.match(i.card));
    hit.forEach((i) => used.add(i.card.id));
    return { label: g.label, hit: hit.sort((a, b) => cardName(a.card).localeCompare(cardName(b.card))) };
  }).filter((g) => g.hit.length);
  const rest = items.filter((i) => !used.has(i.card.id));
  if (rest.length) groups.push({ label: 'Other', hit: rest });

  // A Discard Card is the same Part after its hand-held kit is dropped, and it
  // ships under that Part (rulebook 1.x/5.x). Listed as a sibling it reads as a
  // second, unrelated weapon - which is exactly how it read to OTTO - so it is
  // attached to its parent instead: indented, named for what it is rather than
  // repeating the parent's name, and NOT dimmed, because dimming was carrying
  // the unrelated "not a counted copy" meaning.
  const discardName = (n: string): string | null => {
    const m = /^(.*?)\s*[（(]\s*D\s*[)）]\s*[）)]?\s*$/.exec(n);
    return m ? m[1].trim() : null;
  };
  for (const g of groups) {
    const out: typeof g.hit = [];
    const taken = new Set<string>();
    for (const i of g.hit) {
      if (taken.has(i.card.id)) continue;
      out.push(i);
      taken.add(i.card.id);
      // Pull this card's discard face up directly beneath it, wherever the
      // alphabet had put it.
      const mine = cardName(i.card).trim().toLowerCase();
      for (const j of g.hit) {
        if (taken.has(j.card.id)) continue;
        const base = discardName(cardName(j.card));
        if (base && base.toLowerCase() === mine) {
          out.push({ ...j, discardOf: i.card.id });
          taken.add(j.card.id);
        }
      }
    }
    g.hit = out;
  }

  const facs = (box.faction ?? [])
    .map((f) => `<span class="tag" data-fac="${esc(f)}">${esc(FACTION_LABEL[f] ?? f)}</span>`)
    .join('');
  const list = groups
    .map(
      (g) => `<h3 class="ref-sub">${esc(g.label)} <span class="fc-n">${g.hit.length}</span></h3>
      <ul class="box-parts ui-list">${g.hit
        .map(
          (i) => {
            // Three shapes of row. A discard face is a child of the row above
            // it. A zero-count card that is NOT a discard is an alternate MODE
            // — literally the same piece of cardboard, flipped — and that is
            // the only thing still called paired. Everything else is a plain
            // counted card.
            const kid = !!i.discardOf;
            const mode = !kid && !i.n;
            return `<li data-card="${esc(i.card.id)}" class="${kid ? 'bp-kid' : ''}${mode ? ' bp-paired' : ''}">
            <span class="bp-name">${
              kid
                ? '<span class="bp-tick" aria-hidden="true">└</span>discarded face'
                : esc(cardName(i.card))
            }</span>
            <span class="bp-slot">${
              mode
                // Deliberately states the DATA fact and offers the usual cause,
                // rather than asserting a physical claim we cannot always
                // check: in the curated boxes these are confirmed second
                // faces, in the leftovers bucket a couple are just unknowns.
                ? '<span class="tag bp-tag" title="In the box, but not counted as a separate copy: usually the other face of a double-sided card, or an alternate mode of the card above it.">same card</span>'
                : ''
            }</span>
            <span class="mono bp-pts">${!kid && i.card.score ? `${i.card.score}p` : ''}</span>
            <span class="bp-n">${i.n > 1 ? `×${i.n}` : ''}</span></li>`;
          },
        )
        .join('')}</ul>`,
    )
    .join('');

  // Only alternate MODES are still counted as "same card"; a discard face is
  // now shown as part of its parent's row rather than tallied as a curiosity.
  const kids = new Set(groups.flatMap((g) => g.hit.filter((i) => i.discardOf).map((i) => i.card.id)));
  const sameCard = items.filter((i) => !i.n && !kids.has(i.card.id)).length;
  return `<h2>${esc(box.name.en || box.name.zh || box.key)}</h2>
    <p class="ref-meta">${esc(
      `${cards} card${cards === 1 ? '' : 's'} · ${pieces} copies${sameCard ? ` · ${sameCard} alternate face${sameCard === 1 ? '' : 's'}` : ''}`,
    )}</p>
    ${facs ? `<div class="ref-kwlinks">${facs}</div>` : ''}
    ${
      box.released === false
        ? '<p class="ref-note ref-unsold">No shop has been seen selling this box, so its cards are listed here but cannot be bought yet.</p>'
        : ''
    }
    ${box.hasImage ? `<div class="box-cover"><img src="${boxCoverUrl(box.id)}" alt="" loading="lazy" data-gone=".box-cover"></div>` : ''}
    <div class="ref-box-tools">
      ${exclusiveToggle('ref-box-excl', boxExclusive)}<span class="fc-n">${exclusive.length} of ${all.length}</span>
      ${isListedBox(box) ? `<button class="inv-cmp-btn" data-compare="${esc(box.key)}">Compare with another box</button>` : ''}
    </div>
    ${list || (boxExclusive ? '<p class="ref-note">Every card in this box also ships in another box.</p>' : '<p class="ref-note">No cards in the data list this box.</p>')}`;
}

// Two boxes against each other, on a sheet of its own: the inventory's
// comparison, drawn by the same code, with each row opening the card.
function compareDetail(key: string): string | null {
  const pool = data.boxes.filter(isListedBox).sort((a, b) => a.id - b.id);
  if (pool.length < 2) return null;
  const [a, b] = key.split('|');
  cmpPair[0] = pool.some((x) => x.key === a) ? a : pool[0].key;
  cmpPair[1] = pool.some((x) => x.key === b) && b !== cmpPair[0] ? b : (pool.find((x) => x.key !== cmpPair[0])?.key ?? '');
  const shared = sharedCount(data.cards, pool, cmpPair[0], cmpPair[1]);
  return `<div class="ref-compare">
    <h2>Compare boxes</h2>
    <p class="ref-meta">${shared} card${shared === 1 ? '' : 's'} in both</p>
    ${exclusiveToggle('ref-cmp-excl', boxExclusive, 'inv-cmp-filter')}
    ${compareGrid(data.cards, pool, cmpPair, boxExclusive, {
      picker: (side) => boxPicker(pool, side, cmpPair[side]),
      rowAttr: (id) => `data-card="${esc(id)}"`,
    })}
  </div>`;
}

// Laid out like a box: art bleeding behind a scrim, name and hook on top. The
// counts are live rather than written into the lore file, so a card added to
// the database shows up here without anyone remembering to update a number.
function factionRow(f: FactionDef): string {
  const owned = data.cards.filter((c) => data.factionOf(c) === f.key);
  const pilots = owned.filter((c) => c.category === 'pilot').length;
  const art = f.art !== false;
  return `<article class="card-tap card-framed box-card${art ? ' has-cover' : ''} faction-card" data-fac="${esc(f.key)}" data-factionitem="${esc(f.key)}">
    ${
      art
        ? `<div class="box-bleed" aria-hidden="true"><img src="${factionArtUrl(f.key)}" alt="" loading="lazy"></div>
           <span class="box-scrim" aria-hidden="true"></span>`
        : ''
    }
    <div class="box-body">
      <div class="card-title">${esc(f.name)}</div>
      ${f.hook ? `<div class="box-meta">${esc(f.hook)}</div>` : ''}
      <div class="card-badges">
        <span class="tag">${esc(FACTION_LABEL[f.key] ?? f.short)}</span>
        <span class="tag mono">${owned.length} card${owned.length === 1 ? '' : 's'}</span>
        ${pilots ? `<span class="tag mono">${pilots} pilot${pilots === 1 ? '' : 's'}</span>` : ''}
      </div>
    </div>
  </article>`;
}

function factionDetail(key: string): string | null {
  const f = data.factions.find((x) => x.key === key);
  if (!f) return null;
  const owned = data.cards.filter((c) => data.factionOf(c) === f.key);
  const count = (label: string, n: number) => (n ? `<span class="tag mono">${n} ${esc(label)}${n === 1 ? '' : 's'}</span>` : '');
  const boxes = data.boxes
    .filter((b) => isListedBox(b) && (b.faction ?? []).includes(f.key))
    .sort((a, b) => a.id - b.id);
  return `<h2>${esc(f.name)}</h2>
    <p class="ref-meta">${esc(FACTION_LABEL[f.key] ?? f.short)}${f.supplier ? ` · supplied by ${esc(f.supplier)}` : ''}</p>
    ${
      f.art === false
        ? ''
        : `<div class="ref-faction-art"><img src="${factionArtUrl(f.key)}" alt="${esc(f.name)} key art" loading="lazy"></div>`
    }
    <div class="ref-lore">${f.text.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    <div class="card-badges">
      ${count('card', owned.length)}
      ${count('pilot', owned.filter((c) => c.category === 'pilot').length)}
      ${count('part', owned.filter((c) => c.category === 'mech_part').length)}
      ${count('drone', owned.filter((c) => c.category === 'drone').length)}
    </div>
    ${boxes.length
      ? `<h3 class="ref-sub">Boxes</h3><p class="ref-boxes">${boxes
          .map((b) => `<a class="kw-link" data-box="${esc(b.key)}">${esc(b.name.en || b.name.zh || b.key)}</a>`)
          .join(', ')}</p>`
      : ''}
    <p class="ref-note">${
      f.ours
        ? 'Not a published faction: the rulebook names only RDL, UN and GoF. This write-up is ours, from how the cards are sold and played.'
        : "Lore and key art are the publisher's, from the official faction pages."
    }</p>`;
}

function boxRow(b: BoxDef): string {
  const { cards, pieces } = boxCardCount(b.key);
  const facs = (b.faction ?? [])
    .map((f) => `<span class="tag">${esc(FACTION_LABEL[f] ?? f)}</span>`)
    .join('');
  const fac = (b.faction ?? [])[0];
  return `<article class="card-tap card-framed box-card${b.hasImage ? ' has-cover' : ''}"${
    fac ? ` data-fac="${esc(fac)}"` : ''
  } data-box="${esc(b.key)}">
    ${
      b.hasImage
        ? `<div class="box-bleed" aria-hidden="true"><img src="${boxCoverUrl(b.id)}" alt="" loading="lazy" data-gone=".box-bleed" data-uncover=".box-card"></div>
           <span class="box-scrim" aria-hidden="true"></span>`
        : ''
    }
    <div class="box-body">
      <div class="card-title">${esc(b.name.en || b.name.zh || b.key)}</div>
      <div class="box-meta">${cards} card${cards === 1 ? '' : 's'} · ${pieces} copies</div>
      <div class="card-badges">${facs}${
        b.released === false ? '<span class="tag tag-unsold">not released yet</span>' : ''
      }</div>
    </div>
  </article>`;
}

// WHERE A QUERY LANDED DECIDES THE ORDER.
//
// The name each pool is known by, which is the half of the haystack that ranks.
const nmFamily = (f: (typeof data.missions.families)[number]) => f.name;
const nmMap = (m: TerrainMap) => m.name.en || m.id;
const nmEnv = (e: EnvironmentCard) => e.name;
const nmFaction = (f: (typeof data.factions)[number]) => f.name;
const nmBox = (b: (typeof data.boxes)[number]) => b.name.en || b.name.zh || b.key;


// ---------- one predicate per pool, shared by the tab lists AND the badges ----------
//
// The counts painted onto the tab strip and the rows a tab then shows have to
// come from the SAME test, or a badge promises matches the tab fails to
// produce. So every filter that used to live inline in render() lives here
// once, and both callers read it.
const matchFamily = (f: (typeof data.missions.families)[number], q: string): boolean =>
  !q || norm(`${f.name} ${f.text} ${(f.faq ?? []).map((x) => x.q + x.a).join(' ')}`).includes(q);
const matchFaction = (f: (typeof data.factions)[number], q: string): boolean =>
  !f.hidden && (!q || norm(`${f.name} ${f.short} ${f.key} ${f.supplier ?? ''} ${f.hook ?? ''} ${f.text}`).includes(q));
const matchBox = (b: (typeof data.boxes)[number], q: string): boolean => {
  if (!q) return true;
  const contents = boxContents(b.key).map((i) => cardName(i.card)).join(' ');
  return norm(`${b.name.en ?? ''} ${b.name.zh ?? ''} ${b.key} ${contents}`).includes(q);
};

const wantFor = (t: Tab): ((c: Card) => boolean) =>
  t === 'parts'
    ? (c) => c.category === 'mech_part'
    : t === 'units'
      ? (c) => c.category === 'drone' || c.category === 'projectile'
      : t === 'tactics'
        ? (c) => c.category === 'tactics_or_upgrade'
        : (c) => c.category === 'pilot';

// Name and rule text both, so searching "Fragile" finds High Temperature by
// the Token it hands out as well as Fragile Platform by its name.
function matchEnvironment(e: EnvironmentCard, q: string): boolean {
  if (!q) return true;
  return norm(`${e.name} ${e.text}`).includes(q);
}

// The id is searched as well as the name, and that is what keeps the OLD names
// working: the ids are still alley, crossroads and hotspot, so somebody who
// knows the map as Hotspot still finds it now the card name Hot Zone is shown.
function matchMap(m: TerrainMap, q: string): boolean {
  if (!q) return true;
  return norm(`${m.name.en ?? ''} ${m.name.zh ?? ''} ${m.id}`).includes(q);
}

const LEGEND_LABEL: Record<string, string> = {
  building: 'Buildings', high_wall: 'High Walls', low_wall: 'Low Walls',
  large_container: 'Large Containers', small_container: 'Small Containers',
};

// The map as its own Battlefield Card presents it: the printed picture, the
// terrain it calls for, and the Environment Card allowance that is printed
// here and in no other place (5.4.1).
function battlefieldCard(m: TerrainMap, laid: number): string {
  const legend = Object.entries(m.legend ?? {})
    .map(([k, n]) => `<span class="tag">${n} ${esc(LEGEND_LABEL[k] ?? k)}</span>`)
    .join('');
  return `<article class="card">
    <div class="card-title">${esc(m.name.en || m.id)}</div>
    <button class="mis-thumb" data-battlefield="${esc(m.id)}" title="Tap for the full card, including the terrain legend">
      <img src="${battlefieldCardUrl(m.id)}" alt="${esc(m.name.en || m.id)} battlefield card" loading="lazy">
      <span>Tap to enlarge</span>
    </button>
    <div class="card-badges">
      ${m.envCards ? `<span class="tag tag-kw">${m.envCards} Environment Cards</span>` : ''}
      ${legend}
    </div>
    <div class="card-body"><p class="dim">${laid} terrain pieces are laid out for this map on the board.</p></div>
  </article>`;
}

function environmentCard(e: EnvironmentCard): string {
  return `<article class="card">
    <div class="card-title">${esc(e.name)}</div>
    <button class="mis-thumb" data-envcard="${esc(e.id)}" title="Tap for the full card">
      <img src="${environmentImageUrl(e.id)}" alt="${esc(e.name)} card" loading="lazy">
      <span>Tap to enlarge</span>
    </button>
    <div class="card-body"><p>${linkKeywords(e.text)}</p></div>
    <div class="card-badges">
      <span class="tag">${e.affects === 'all' ? 'Every Unit' : 'Ground Units'}</span>
      ${e.oneShot ? '<span class="tag tag-kw">Removed when it fires</span>' : ''}
    </div>
  </article>`;
}

function tabCounts(q: string): Record<Tab, number> {
  const cardsIn = (t: Tab): number => data.cards.filter(wantFor(t)).filter((c) => matchCard(c, q)).length;
  return {
    keywords: data.keywords.filter((k) => matchKeyword(k, q)).length,
    parts: cardsIn('parts'),
    units: cardsIn('units'),
    pilots: cardsIn('pilots'),
    tactics: cardsIn('tactics'),
    missions:
      data.missions.cards.filter((m) => matchMission(m, q)).length +
      data.missions.families.filter((f) => matchFamily(f, q)).length +
      data.secondary.filter((s) => matchSecondary(s, q)).length,
    battlefield:
      data.terrain.maps.filter((m) => matchMap(m, q)).length +
      data.environments.cards.filter((e) => matchEnvironment(e, q)).length,
    factions: data.factions.filter((f) => matchFaction(f, q)).length,
    boxes: data.boxes.filter(isListedBox).filter((b) => matchBox(b, q)).length,
    rules:
      data.play.phases.filter((x) => matchPhase(x, q)).length +
      data.play.timings.filter((x) => matchTiming(x, q)).length +
      data.play.stances.filter((x) => matchStance(x, q)).length +
      data.mechanics.filter((m) => matchMechanic(m, q)).length +
      dieEntries().filter((d) => matchDie(d, q)).length +
      Object.entries(data.dice?.offsetRules ?? {}).filter(([k, v]) => !q || norm(`${k} ${v}`).includes(q)).length +
      STATUSES.filter((d) => matchStatus(d, q)).length +
      (currentSeason()?.rules ?? []).filter((r) => matchSeason(r, q)).length,
  };
}

// While a search is live the strip doubles as the match map: every tab carries
// its count, and a tab with nothing to show says so instead of inviting a
// dead-end tap. With no search the strip goes back to being plain tabs.
function paintTabs(q: string, everywhere: boolean): void {
  const counts = q ? tabCounts(q) : null;
  document.querySelectorAll<HTMLButtonElement>('#ref-tabs button').forEach((b) => {
    const t = b.dataset.tab as Tab;
    b.classList.toggle('active', !everywhere && t === tab);
    let n = b.querySelector<HTMLElement>('.tab-n');
    if (!counts) {
      n?.remove();
      b.classList.remove('no-match');
      return;
    }
    if (!n) {
      n = document.createElement('span');
      n.className = 'tab-n';
      b.appendChild(n);
    }
    n.textContent = String(counts[t]);
    b.classList.toggle('no-match', counts[t] === 0);
  });
}

// The everywhere view: a fresh search casts across every tab at once, because
// mid-game nobody knows (or cares) which tab the answer lives in. Each group
// is a horizontal strip of compact PREVIEW CHIPS that link to the real item -
// never the tabs' full renderings, which are built for the masonry grid and
// stack into odd towers of art and empty space outside it. Tapping a chip
// opens the detail; a group header or a tab narrows; clearing the box returns
// to the tab that was open.
function renderEverywhere(el: HTMLElement, q: string): void {
  const label: Record<Tab, string> = {
    keywords: 'Keywords', parts: 'Parts', units: 'Units', pilots: 'Pilots', tactics: 'Tactics',
    missions: 'Missions', battlefield: 'Battlefield', factions: 'Factions',
    boxes: 'Boxes', rules: 'Rules',
  };
  // Result rows, forum-style: one per line, name on the left and its kind on
  // the right, scanned top to bottom. Ten per group before the "all" link,
  // which is about a screen on a phone.
  const CAP = 10;
  const chip = (attr: string, title: string, sub: string): string =>
    `<button class="ref-hit" ${attr}><b>${esc(title)}</b><span>${esc(sub)}</span></button>`;
  type Group = { t: Tab; total: number; rows: string[] };
  const groups: Group[] = [];

  const kws = found(data.keywords, q, matchKeyword, nmKeyword);
  if (kws.length) {
    groups.push({
      t: 'keywords', total: kws.length,
      rows: kws.slice(0, CAP).map((k) => {
        const name = k.en?.name?.replace(/^[•·\s]+/, '') || k.key;
        return chip(`data-kwitem="${esc(name)}"`, name, 'keyword');
      }),
    });
  }

  for (const t of ['parts', 'units', 'pilots', 'tactics'] as Tab[]) {
    const pool = found(data.cards.filter(wantFor(t)), q, matchCard, nmCard,
      (a, b) => cardName(a).localeCompare(cardName(b)));
    if (pool.length) {
      groups.push({
        t, total: pool.length,
        rows: pool.slice(0, CAP).map((c) => {
          const kind = c.type ? SLOT_LABEL[c.type] ?? c.type : c.category === 'pilot' ? 'pilot' : c.category;
          const pts = c.score ? ` · ${c.score}p` : '';
          return chip(`data-card="${esc(c.id)}"`, cardName(c), `${kind}${pts}`);
        }),
      });
    }
  }

  const mains = found(data.missions.cards, q, matchMission, nmMission);
  const fams = found(data.missions.families, q, matchFamily, nmFamily);
  const secs = found(data.secondary, q, matchSecondary, nmSecondary);
  if (mains.length + fams.length + secs.length) {
    const rows = [
      ...mains.map((m) => chip(`data-mission="${esc(m.id)}"`, m.name, 'Main Task')),
      ...secs.map((s) => chip(`data-secondary="${esc(s.id)}"`, s.name, 'Secondary Task')),
    ];
    groups.push({ t: 'missions', total: mains.length + fams.length + secs.length, rows: rows.slice(0, CAP) });
  }

  // The tab strip already counted these, so leaving them out of the results
  // showed a count with nothing behind it. There is no detail sheet for an
  // Environment Card, so the row opens the tab rather than a card.
  const bmaps = found(data.terrain.maps, q, matchMap, nmMap);
  const envs = found(data.environments.cards, q, matchEnvironment, nmEnv);
  if (bmaps.length + envs.length) {
    groups.push({
      t: 'battlefield',
      total: bmaps.length + envs.length,
      rows: [
        ...bmaps.map((m) => chip('data-goto="battlefield"', m.name.en || m.id, 'Battlefield')),
        ...envs.map((e) => chip('data-goto="battlefield"', e.name, 'Environment')),
      ].slice(0, CAP),
    });
  }

  const facs = found(data.factions, q, matchFaction, nmFaction);
  if (facs.length) {
    groups.push({
      t: 'factions', total: facs.length,
      rows: facs.slice(0, CAP).map((f) => chip(`data-factionitem="${esc(f.key)}"`, f.name, 'faction')),
    });
  }

  const boxes = found(data.boxes.filter(isListedBox), q, matchBox, nmBox, (a, b) => a.id - b.id);
  if (boxes.length) {
    groups.push({
      t: 'boxes', total: boxes.length,
      rows: boxes.slice(0, CAP).map((b) => chip(`data-box="${esc(b.key)}"`, b.name.en || b.name.zh || b.key, 'box')),
    });
  }

  const mechs = found(data.mechanics, q, matchMechanic, nmMechanic);
  const season = currentSeason();
  const seasonHits = season ? found(season.rules, q, matchSeason, nmSeason) : [];
  const playBits =
    data.play.phases.filter((x) => matchPhase(x, q)).length +
    data.play.timings.filter((x) => matchTiming(x, q)).length +
    data.play.stances.filter((x) => matchStance(x, q)).length +
    STATUSES.filter((d) => matchStatus(d, q)).length;
  if (mechs.length + seasonHits.length + playBits) {
    // Mechanics and Season Rules are the chips worth naming; phases, timings,
    // stances and tokens count toward the total and live behind the group's
    // Rules link. A Season Rule's chip says it is optional.
    // The two pools merge by how well each name answers the search, so
    // "stabilize" puts the Season Rule of that name above the entries that
    // only mention it; the sort is stable, so each pool keeps its own order.
    groups.push({
      t: 'rules', total: mechs.length + seasonHits.length + playBits,
      rows: [
        ...mechs.map((m) => ({ r: rank(m.name, q), html: chip('data-goto="rules"', m.name, m.ref ?? 'rules') })),
        ...seasonHits.map((s) => ({ r: rank(s.name, q), html: chip(`data-season="${esc(s.id)}"`, s.name, `${season!.label} · optional`) })),
      ].sort((a, b) => a.r - b.r).slice(0, CAP).map((x) => x.html),
    });
  }

  const total = groups.reduce((s, g) => s + g.total, 0);
  el.innerHTML = groups.length
    ? `<p class="ref-count">${total} match${total === 1 ? '' : 'es'} everywhere<small>tap an item to open it, a group or a tab to narrow</small></p>` +
      groups
        .map(
          (g) => `<div class="ref-group">
        <button class="ref-group-head" data-goto="${g.t}">${esc(label[g.t])} <span class="fc-n">${g.total}</span><span class="rg-open">›</span></button>
        <div class="ref-hits">${g.rows.join('')}${
          g.total > g.rows.length ? `<button class="ref-hit ref-hit-more" data-goto="${g.t}"><b>All ${g.total} in ${esc(label[g.t])}</b><span>›</span></button>` : ''
        }</div>
      </div>`,
        )
        .join('')
    : '<p class="ref-count">No matches anywhere</p>';

  el.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      // A goto wrapping a clickable row (the Rules previews) is a navigation,
      // not a detail open, so it wins the click.
      ev.stopPropagation();
      tab = b.dataset.goto as Tab;
      allMode = false;
      render();
      window.scrollTo({ top: 0 });
    }),
  );
}

function render(): void {
  const q = norm(query.trim());
  const everywhere = !!q && allMode;
  paintTabs(q, everywhere);
  const el = body();
  if (everywhere) {
    renderEverywhere(el, q);
    return;
  }

  if (tab === 'keywords') {
    const list = found(data.keywords, q, matchKeyword, nmKeyword,
      (a, b) => (a.en?.name || a.key).localeCompare(b.en?.name || b.key));
    el.innerHTML = list.length
      ? `<p class="ref-count">${list.length} keyword${list.length === 1 ? '' : 's'}</p>${list.map(keywordCard).join('')}`
      : '<p class="ref-count">No matches</p>';
    return;
  }

  if (tab === 'missions') {
    const fam = new Map(data.missions.families.map((f) => [f.id, f]));
    const cards = found(data.missions.cards, q, matchMission, nmMission);
    const fams = found(data.missions.families, q, matchFamily, nmFamily);
    const secs = found(data.secondary, q, matchSecondary, nmSecondary);
    if (!cards.length && !fams.length && !secs.length) {
      el.innerHTML = '<p class="ref-count">No matches</p>';
      return;
    }
    el.innerHTML =
      `<p class="ref-count">${cards.length} main task${cards.length === 1 ? '' : 's'}</p>` +
      cards
        .map((m) => {
          const f = fam.get(m.family);
          return `<article class="card">
            <div class="card-title">${esc(m.name)}</div>
            <button class="mis-thumb" data-mission="${esc(m.id)}" title="Tap for the full card, including where the terrain and objectives sit">
              <img src="${missionImageUrl(m.id)}" alt="${esc(m.name)} card" loading="lazy">
              <span>Tap to enlarge</span>
            </button>
            <div class="card-body">
              <p><b>Setup.</b> ${linkKeywords(m.setup)}</p>
              <p><b>Scoring.</b> ${linkKeywords(m.scoring)}</p>
              ${m.deployment ? `<p><b>Deployment.</b> ${linkKeywords(m.deployment)}</p>` : ''}
              ${mechBlocks(m.setup, m.scoring)}
            </div>
            <div class="card-badges">
              ${f ? `<span class="tag tag-kw">${esc(f.name)}</span>` : ''}
              ${typeof m.vp === 'number' ? `<span class="tag mono">${m.vp} VP</span>` : ''}
              ${(m.zones ?? []).map((z) => `<span class="tag">${esc(z)}</span>`).join('')}
              ${m.inRulebook ? '<span class="tag mono">in rulebook</span>' : ''}
            </div>
          </article>`;
        })
        .join('') +
      (fams.length ? '<p class="ref-count">How each mission type works</p>' : '') +
      fams
        .map(
          (f) => `<article class="card">
            <div class="card-title">${esc(f.name)}</div>
            <div class="card-body">${linkKeywords(f.text).replace(/\n/g, '<br>')}</div>
            ${mechBlocks(f.text, ...(f.faq ?? []).map((x) => x.a))}
            ${(f.faq ?? []).length
              ? `<div class="mis-faq">${(f.faq ?? [])
                  .map((x) => `<p><b>Q.</b> ${linkKeywords(x.q)}<br><b>A.</b> ${linkKeywords(x.a)}</p>`)
                  .join('')}</div>`
              : ''}
          </article>`,
        )
        .join('') +
      (secs.length
        ? `<p class="ref-count">${secs.length} secondary task${secs.length === 1 ? '' : 's'}<small>each player picks 1 and reveals it</small></p>` +
          secs
            .map(
              (s) => `<article class="card">
            <div class="card-title">${esc(s.name)}</div>
            <button class="mis-thumb" data-secondary="${esc(s.id)}" title="Tap for the full card">
              <img src="${secondaryImageUrl(s.id)}" alt="${esc(s.name)} card" loading="lazy">
              <span>Tap to enlarge</span>
            </button>
            <div class="card-body">
              <p><b>Setup.</b> ${linkKeywords(s.setup)}</p>
              <p><b>Scoring.</b> ${linkKeywords(s.scoring)}</p>
              ${mechBlocks(s.setup, s.scoring)}
            </div>
            <div class="card-badges">
              ${typeof s.vp === 'number' ? `<span class="tag mono">${s.vp} VP</span>` : ''}
              ${s.token ? `<span class="tag tag-kw">${esc(s.token)} token</span>` : '<span class="tag">no token</span>'}
              ${s.inRulebook ? '<span class="tag mono">in rulebook</span>' : ''}
            </div>
          </article>`,
            )
            .join('')
        : '');
    return;
  }

  if (tab === 'battlefield') {
    const maps = found(data.terrain.maps, q, matchMap, nmMap);
    const list = found(data.environments.cards, q, matchEnvironment, nmEnv);
    // The placement rules are the half that is NOT on the cards, so they lead:
    // somebody reading this tab wants to know how many they may lay down at
    // least as much as they want the five effects.
    const intro = `<article class="card env-intro">
      <div class="card-title">Using Environment Cards</div>
      <div class="card-body">
        <p>An Environment Card is the size of one Large Grid and is placed on the board to give
        that Grid a special effect.</p>
        <p>If they are used, the two players place them <b>alternately</b> while setting up the
        battlefield. The total may not exceed the number printed on the Battlefield Card, which is
        <b>4</b> on every 12x12 layout. They generally cannot be placed on Tactical Zones.</p>
      </div>
      <div class="card-badges"><span class="tag mono">${esc(data.environments.rule)}</span></div>
    </article>`;
    if (!maps.length && !list.length) {
      el.innerHTML = '<p class="ref-count">No matches</p>';
      return;
    }
    el.innerHTML =
      (maps.length
        ? `<p class="ref-count">${maps.length} map${maps.length === 1 ? '' : 's'}</p>`
          + maps.map((m) => battlefieldCard(m, (data.terrain.layouts[m.id] ?? []).length)).join('')
        : '')
      + (list.length
        ? `<p class="ref-count">${list.length} environment card${list.length === 1 ? '' : 's'}</p>`
          + (q ? '' : intro)
          + list.map(environmentCard).join('')
        : '');
    return;
  }

  if (tab === 'rules') {
    // The tab is drawn by refcards.ts, the ONE copy the pad's Find shows too
    // (OTTO, 2026-09-30); this page keeps which filter is chosen and the row.
    el.innerHTML = rulesTab(q, rulesSection);
    // On a screen too narrow for every chip the row scrolls sideways, and a
    // chosen chip past its edge (Season, the last) left the reader unable to
    // see what the tab was narrowed to. The row alone scrolls, never the page.
    const row = el.querySelector<HTMLElement>('.ref-facets');
    const on = row?.querySelector<HTMLElement>('.ref-facet.active');
    if (row && on && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
    }
    el.querySelectorAll<HTMLButtonElement>('[data-rules]').forEach((b) =>
      b.addEventListener('click', () => {
        rulesSection = b.dataset.rules || undefined;
        render();
        body().scrollTop = 0;
      }),
    );
    return;
  }

  if (tab === 'factions') {
    const list = found(data.factions, q, matchFaction, nmFaction);
    el.innerHTML = list.length
      ? `<p class="ref-count">${list.length} faction${list.length === 1 ? '' : 's'} · tap one for its story</p>${list.map(factionRow).join('')}`
      : '<p class="ref-count">No matches</p>';
    return;
  }

  if (tab === 'boxes') {
    const sellable = data.boxes.filter(isListedBox);
    const pool = found(sellable, q, matchBox, nmBox);
    const facs = FACTION_ORDER.filter((f) => sellable.some((b) => (b.faction ?? []).includes(f)));
    const choice = factionChoice.boxes;
    const list = pool
      .filter((b) => !choice || (b.faction ?? []).includes(choice))
      .sort((a, b) => a.id - b.id);
    el.innerHTML =
      `<div class="ref-facets ref-facets-faction">
        <button class="ref-facet${choice ? '' : ' active'}" data-faction="">All <span class="fc-n">${pool.length}</span></button>
        ${facs
          .map((f) => {
            const n = pool.filter((b) => (b.faction ?? []).includes(f)).length;
            return `<button class="ref-facet${choice === f ? ' active' : ''}${n ? '' : ' empty'}" data-fac="${esc(f)}" data-faction="${esc(f)}"${
              n ? '' : ' disabled'
            }>${esc(FACTION_LABEL[f] ?? f)} <span class="fc-n">${n}</span></button>`;
          })
          .join('')}
        <button class="inv-cmp-btn" data-compare="">Compare boxes</button>
      </div>` +
      (list.length
        ? `<p class="ref-count">${list.length} box${list.length === 1 ? '' : 'es'} · tap one to list what is inside</p>${list.map(boxRow).join('')}`
        : '<p class="ref-count">No matches</p>');
    el.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach((b) =>
      b.addEventListener('click', () => {
        factionChoice.boxes = b.dataset.faction || undefined;
        render();
        body().scrollTop = 0;
      }),
    );
    return;
  }

  const pool = found(data.cards.filter(wantFor(tab)), q, matchCard, nmCard);

  const kinds = facetsFor(tab);
  const factions = factionFacets(pool);
  const kind = kinds.find((f) => f.id === facetChoice[tab]);
  const faction = factions.find((f) => f.id === factionChoice[tab]);

  const list = pool
    .filter((c) => (!kind || kind.match(c)) && (!faction || faction.match(c)))
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));

  const row = (
    items: Facet[],
    activeId: string | undefined,
    attr: string,
    others: Facet | undefined,
    extraClass = '',
  ): string => {
    if (!items.length) return '';
    const base = pool.filter((c) => !others || others.match(c));
    return `<div class="ref-facets${extraClass}">
      <button class="ref-facet${activeId ? '' : ' active'}" data-${attr}="">All <span class="fc-n">${base.length}</span></button>
      ${items
        .map((f) => {
          const n = base.filter(f.match).length;
          const on = activeId === f.id;
          return `<button class="ref-facet${on ? ' active' : ''}${n ? '' : ' empty'}"${
            extraClass ? ` data-fac="${esc(f.id)}"` : ''
          } data-${attr}="${esc(f.id)}"${n ? '' : ' disabled'}>${esc(f.label)} <span class="fc-n">${n}</span></button>`;
        })
        .join('')}
    </div>`;
  };

  el.innerHTML =
    row(kinds, facetChoice[tab], 'facet', faction) +
    row(factions, factionChoice[tab], 'faction', kind, ' ref-facets-faction') +
    (list.length
      ? `<p class="ref-count">${list.length} card${list.length === 1 ? '' : 's'}</p>${list.map(cardRow).join('')}`
      : '<p class="ref-count">No matches</p>');

  el.querySelectorAll<HTMLButtonElement>('[data-facet]').forEach((b) =>
    b.addEventListener('click', () => {
      facetChoice[tab] = b.dataset.facet || undefined;
      render();
      body().scrollTop = 0;
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach((b) =>
    b.addEventListener('click', () => {
      factionChoice[tab] = b.dataset.faction || undefined;
      render();
      body().scrollTop = 0;
    }),
  );
  fillPortraits(el, true);
}

// The same pinning the report dialog uses, and here for the same reason: this
// page is the one that scrolls, `overflow: hidden` alone does not hold it on
// iOS, and a sheet opened from halfway down must come back to halfway down.
// Two locks can be live at once -- a report opens over the detail sheet -- so
// whoever pinned FIRST owns the offset and the restore.
let refLockedAt = 0;

function lockRefPage(): void {
  if (document.body.classList.contains('ref-locked') || document.body.classList.contains('rp-locked')) return;
  if (document.documentElement.scrollHeight <= window.innerHeight) return;
  refLockedAt = window.scrollY;
  document.body.style.top = `-${refLockedAt}px`;
  document.body.classList.add('ref-locked');
}

function unlockRefPage(): void {
  if (!document.body.classList.contains('ref-locked')) return;
  document.body.classList.remove('ref-locked');
  document.body.style.top = '';
  window.scrollTo(0, refLockedAt);
}

// `changelog` is the master changelog, keyed by revision; `rule` a Rules entry,
// which only that sheet opens; `season` a Season Rule, by its id. `log`: opened
// from the master changelog, so the view's own Changelog is shown open.
interface DetailView {
  kind: 'card' | 'keyword' | 'box' | 'faction' | 'compare' | 'changelog' | 'rule' | 'season';
  key: string;
  scroll?: number;
  log?: boolean;
}

let navStack: DetailView[] = [];

const sheet = () => document.getElementById('ref-detail')!;
const sheetScroller = () => sheet().querySelector('.ref-detail-inner') as HTMLElement;

// This page's own sheets first; the ones the pad opens too come from refcards.ts.
function viewHtml(v: DetailView): string | null {
  if (v.kind === 'box') return boxDetail(v.key);
  if (v.kind === 'faction') return factionDetail(v.key);
  if (v.kind === 'compare') return compareDetail(v.key);
  return sheetHtml(v.kind, v.key);
}

// Redraws whatever sheet is open, in place: the exclusive tick and the compare
// pickers change what the same sheet shows, and are not a navigation.
function repaintDetail(): void {
  const top = navStack[navStack.length - 1];
  if (!top || sheet().hidden) return;
  const html = viewHtml(top);
  if (html !== null) paintDetail(html, sheetScroller().scrollTop);
}

// The scalar fields exactly as we hold them, so a "this is wrong" report can be
// diffed against the printed thing without a second round trip asking what we
// show. Nested objects are flattened one level, because a keyword keeps its
// text under en/zh/jp and that text is the whole point of reporting one.
function flatten(src: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') {
      if (prefix) continue;
      Object.assign(out, flatten(v, `${k}.`));
      continue;
    }
    out[prefix + k] = String(v);
  }
  return out;
}

// WHATEVER IS OPEN, not just a card. The sheet shows cards, keywords, Boxes and
// factions, and for a long time this read only the card case -- so opening a
// keyword and reporting it produced a report that named nothing.
function shownFor(v: DetailView | undefined): Record<string, string> {
  if (!v) return {};
  if (v.kind === 'card') return flatten(data.byId.get(v.key));
  if (v.kind === 'keyword') return flatten(data.keyword(v.key));
  if (v.kind === 'box') return flatten(data.boxes.find((b) => b.key === v.key));
  if (v.kind === 'compare' || v.kind === 'changelog') return {};
  if (v.kind === 'rule') return flatten(data.mechanics.find((m) => m.id === v.key));
  if (v.kind === 'season') return flatten(data.seasons.flatMap((s) => s.rules).find((r) => r.id === v.key));
  return flatten(data.factions.find((f) => f.key === v.key));
}

// The sheet's vocabulary is already the report's, bar the tab-only categories
// the sheet has no view for.
const TAB_CATEGORY: Record<string, ReportCategory> = {
  keywords: 'keyword', parts: 'card', units: 'card', pilots: 'card', tactics: 'card',
  boxes: 'box', factions: 'faction', missions: 'mission', rules: 'rules',
  battlefield: 'other',
};

function viewLabel(v: DetailView): string {
  if (v.kind === 'box') {
    const b = data.boxes.find((x) => x.key === v.key);
    return b ? b.name.en || b.name.zh || b.key : v.key;
  }
  if (v.kind === 'faction') return data.factions.find((x) => x.key === v.key)?.name ?? v.key;
  if (v.kind === 'compare') return 'Compare boxes';
  return sheetLabel(v.kind, v.key);
}

function navigateDetail(kind: DetailView['kind'], rawKey: string, opts: { log?: boolean } = {}): void {
  const key = kind === 'keyword' ? data.keyword(rawKey)?.key ?? rawKey : rawKey;
  const v: DetailView = { kind, key, ...(opts.log ? { log: true } : {}) };
  const html = viewHtml(v);
  if (html === null) return;

  if (sheet().hidden) {
    navStack = [];
  } else {
    const top = navStack[navStack.length - 1];
    if (top && top.kind === kind && top.key === key) return;
    const under = navStack[navStack.length - 2];
    if (under && under.kind === kind && under.key === key) return backDetail();
    if (top) top.scroll = sheetScroller().scrollTop;
  }
  navStack.push(v);
  paintDetail(html, 0);
  if (v.log) revealLog();
}




function backDetail(): void {
  if (navStack.length < 2) return closeDetail();
  navStack.pop();
  const prev = navStack[navStack.length - 1];
  const html = viewHtml(prev);
  if (html === null) return closeDetail();
  paintDetail(html, prev.scroll ?? 0);
}


// This page's navigation, as the shared router (refsheet.ts) drives it.
const sheetNav: SheetNav = {
  open: (kind, key, opts) => navigateDetail(kind, key, opts),
  top: () => (sheet().hidden ? undefined : navStack[navStack.length - 1]),
  retarget: (key) => {
    const top = navStack[navStack.length - 1];
    if (!top) return;
    top.key = key;
    const html = viewHtml(top);
    if (html !== null) paintDetail(html, 0);
  },
};

function paintDetail(html: string, scrollTop: number): void {
  const content = document.getElementById('ref-detail-content')!;
  // The box cover survives a repaint of the same sheet (the Exclusive tick,
  // the compare pickers): a fresh <img> for the same picture starts at no
  // height and loads again, so the cover shrank to nothing and grew back on
  // every tick (OTTO, 2026-09-29). The loaded element is kept instead.
  const oldCover = content.querySelector('.box-cover');
  const oldSrc = oldCover?.querySelector('img')?.src;
  content.innerHTML = html;
  const cover = content.querySelector('.box-cover');
  if (oldCover && cover && oldSrc && cover.querySelector('img')?.src === oldSrc) cover.replaceWith(oldCover);
  decorateSheetHead(content);
  content.querySelectorAll<HTMLElement>('[data-img]').forEach((slot) => {
    // Two slots hold the same scan now: the thumbnail on the Card tab and the
    // full one on the Photo tab. They take different classes because
    // `ref-cardimg` caps at 320px, which is the full view's size and eight
    // times the thumbnail's.
    const isThumb = !!slot.closest('.dthumb');
    // The thumbnail takes a COPY: the image cache holds one element per id, so
    // two slots sharing it would leave whichever mounted first empty.
    // A card with no scan shows its placeholder in both places instead, so the
    // thumbnail and the Photo tab stay (OTTO, 2026-09-28). They used to be
    // dropped, which left no sign that a printed card exists at all.
    (isThumb ? mountCardImageCopy : mountCardImage)(slot, slot.dataset.img!, isThumb ? 'dthumb-img' : 'ref-cardimg', {
      label: slot.dataset.imgLabel ?? '',
      wide: slot.dataset.imgWide === '1',
    });
  });
  // A card in no box at all still has a Boxes tab saying so in a sentence, but
  // an EMPTY panel would be a dead end, so that one is dropped outright.
  if (!content.querySelector('[data-dpanel="boxes"]')?.textContent?.trim()) {
    const t = content.querySelector<HTMLElement>('[data-dtab="boxes"]');
    if (t) t.hidden = true;
  }
  fillPortraits(content, false);
  // The master changelog's filter goes on before the scroll comes back, which
  // was measured on the filtered list.
  if (content.querySelector('.cl-list')) applyChangelogFilter(content);
  sheet().hidden = false;
  lockRefPage();
  sheetScroller().scrollTop = scrollTop;
  // A fresh card starts with no floor: the previous card's tallest panel has
  // nothing to do with this one, and inheriting it would open a one-action
  // Part into the empty height of a six-action one.
  content.style.removeProperty('--dpanel-h');
  delete content.dataset.panelMax;
  holdDetailHeight(content);

  const back = document.getElementById('ref-detail-back') as HTMLButtonElement;
  const prev = navStack.length >= 2 ? navStack[navStack.length - 2] : null;
  back.hidden = !prev;
  const label = prev ? `Back to ${viewLabel(prev)}` : 'Back';
  back.title = label;
  back.setAttribute('aria-label', label);
}

function closeDetail(): void {
  sheet().hidden = true;
  unlockRefPage();
  navStack = [];
}

function showMissionImage(id: string, kind: 'main' | 'secondary' = 'main'): void {
  const card =
    kind === 'secondary' ? data.secondary.find((s) => s.id === id) : data.missions.cards.find((m) => m.id === id);
  showCardImage(kind === 'secondary' ? secondaryImageUrl(id) : missionImageUrl(id), card?.name ?? id);
}

// Any card worth reading at full size. The reference column is narrow enough
// that a battlefield card's terrain legend and an environment card's rule are
// both too small to read in place.
function showCardImage(src: string, label: string): void {
  document.querySelector('.mis-lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'mis-lightbox';
  box.innerHTML = `<div class="mis-lightbox-inner">
      <button class="mis-close" title="Close">✕</button>
      <img src="${src}" alt="${esc(label)} card">
      <p>${esc(label)}</p>
    </div>`;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    // Only if the sheet is not still up: the lock is the SHEET's whenever both
    // are open, and lockRefPage above will have declined to take it. Today the
    // thumbs that open this all live in tab content, so the two are never up
    // together - this is the guard for the day one is added to a card.
    if (sheet().hidden) unlockRefPage();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    close();
  };
  box.addEventListener('click', (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).closest('.mis-close')) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  lockRefPage();
}

async function init(): Promise<void> {
  watchImageFallbacks();
  data = await loadData();
  // The shared renderers hold their own reference to the database, and this
  // page lends them its Boxes tab so a card can still say which boxes hold it.
  useCardData(data, { boxRow });
  preloadCardImages(data.cards.map((c) => c.id));
  void runFirstVisitPreload().then(() => warmAllImagesWhenIdle());
  registerOffline();
  watchForUpdates();

  document.querySelectorAll<HTMLButtonElement>('#ref-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as Tab;
      // Picking a tab is the narrowing gesture, so the everywhere view yields.
      // render() paints the active state, badges included.
      allMode = false;
      render();
      window.scrollTo({ top: 0 });
    }),
  );

  const search = document.getElementById('ref-search') as HTMLInputElement;
  search.addEventListener('input', () => {
    // Typing from an empty box starts a NEW question, so it casts wide again.
    // Editing an existing query keeps whatever narrowing was already chosen.
    if (!norm(query.trim()) && norm(search.value.trim())) allMode = true;
    query = search.value;
    render();
  });

  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    // Every link both pages' sheets and tabs carry (refsheet.ts).
    if (runSheetClick(ev, sheetNav)) return;
    // Also live in the everywhere view, which reuses the keyword cards.
    const kwItem = t.closest<HTMLElement>('[data-kwitem]');
    if (kwItem && (tab === 'keywords' || (allMode && norm(query.trim())))) {
      navigateDetail('keyword', kwItem.dataset.kwitem!);
      return;
    }
    const mis = t.closest<HTMLElement>('[data-mission]');
    if (mis) {
      ev.preventDefault();
      showMissionImage(mis.dataset.mission!);
      return;
    }
    const bf = t.closest<HTMLElement>('[data-battlefield]');
    if (bf) {
      ev.preventDefault();
      const m = data.terrain.maps.find((x) => x.id === bf.dataset.battlefield);
      showCardImage(battlefieldCardUrl(bf.dataset.battlefield!), m?.name.en || bf.dataset.battlefield!);
      return;
    }
    const envc = t.closest<HTMLElement>('[data-envcard]');
    if (envc) {
      ev.preventDefault();
      const e = data.environments.cards.find((x) => x.id === envc.dataset.envcard);
      showCardImage(environmentImageUrl(envc.dataset.envcard!), e?.name ?? envc.dataset.envcard!);
      return;
    }
    const sec = t.closest<HTMLElement>('[data-secondary]');
    if (sec) {
      ev.preventDefault();
      showMissionImage(sec.dataset.secondary!, 'secondary');
      return;
    }
    const fac = t.closest<HTMLElement>('[data-factionitem]');
    if (fac) {
      ev.preventDefault();
      navigateDetail('faction', fac.dataset.factionitem!);
      return;
    }
    const cmp = t.closest<HTMLElement>('[data-compare]');
    if (cmp) {
      ev.preventDefault();
      // From a box's own sheet that box takes the left side; from the tab the
      // last pair (or the first two boxes) comes back.
      const left = cmp.dataset.compare || cmpPair[0];
      const right = cmpPair[1] !== left ? cmpPair[1] : cmpPair[0];
      navigateDetail('compare', `${left}|${right}`);
      return;
    }
    const box = t.closest<HTMLElement>('[data-box]');
    if (box) {
      ev.preventDefault();
      navigateDetail('box', box.dataset.box!);
      return;
    }
    const card = t.closest<HTMLElement>('[data-card]');
    if (card) navigateDetail('card', card.dataset.card!);
  });

  // The clamp is measured against the window, so it has to be taken again when
  // the window changes. Recomputed rather than merely cleared: an orientation
  // change on a phone can halve the height, and a floor measured for the old
  // one would go on forcing a scrollbar that no longer needs to exist.
  window.addEventListener('resize', () => {
    const content = document.getElementById('ref-detail-content');
    if (!content || sheet().hidden) return;
    // The cap moved, so the remembered max is re-measured against the new
    // window rather than carried over from the old one.
    content.style.removeProperty('--dpanel-h');
    delete content.dataset.panelMax;
    holdDetailHeight(content);
  });
  // The exclusive tick and the compare pickers live inside the sheet's
  // markup, which paintDetail rewrites, so they are answered here once.
  document.addEventListener('change', (ev) => {
    const el = ev.target as HTMLElement;
    if (!el.closest('#ref-detail')) return;
    if (el.id === 'ref-box-excl' || el.id === 'ref-cmp-excl') {
      boxExclusive = (el as HTMLInputElement).checked;
      repaintDetail();
      return;
    }
    if (el.classList.contains('inv-cmp-pick')) {
      const sel = el as HTMLSelectElement;
      cmpPair[Number(sel.dataset.side) as 0 | 1] = sel.value;
      const top = navStack[navStack.length - 1];
      if (top?.kind === 'compare') {
        top.key = cmpPair.join('|');
        repaintDetail();
      }
    }
  });
  // The master changelog's search, filtering in place as it is typed.
  document.addEventListener('input', runSheetInput);
  document.getElementById('ref-detail-back')!.addEventListener('click', backDetail);
  document.getElementById('ref-detail-close')!.addEventListener('click', closeDetail);

  // Opens knowing which card is on screen, because navStack already does. A
  // report that has to ask "which card?" gets answered with a description, and
  // a description does not find a row in the data.
  const reportOpenCard = (): void => {
    const open = sheet().hidden ? undefined : navStack[navStack.length - 1];
    openReferenceReport({
      subject: open ? { kind: open.kind, key: open.key, name: viewLabel(open) } : null,
      // What is open decides it; failing that, the tab does. Rules never open a
      // sheet at all, so the tab is the only signal there -- which is exactly
      // the case that had no way to be reported before.
      category: open
        ? (open.kind === 'rule' || open.kind === 'season' ? 'rules' : open.kind === 'changelog' || open.kind === 'compare' ? 'other' : (open.kind as ReportCategory))
        : (TAB_CATEGORY[tab] ?? 'other'),
      looking: { tab, search: query.trim() },
      shown: shownFor(open),
    });
  };
  // TWO DOORS, one room. The header button is the only one reachable with no
  // card open, and the card's own flag is the only one reachable WITH one --
  // the detail sheet is a modal, so it covers the header the whole time it is
  // up. Wiring only the header meant the card report could never actually name
  // a card.
  document.getElementById('ref-report')!.addEventListener('click', reportOpenCard);
  document.getElementById('ref-detail-report')!.addEventListener('click', reportOpenCard);
  document.getElementById('ref-detail')!.addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeDetail();
  });
  document.addEventListener('keydown', (ev) => {
    if (runSheetKey(ev)) return;
    if (ev.key === 'Escape') closeDetail();
  });
  // Tabbing out of the revision menu closes it, as a click elsewhere does.
  document.addEventListener('focusin', runSheetFocus);

  render();
}

init().catch((e) => {
  body().innerHTML = `<p class="ref-count">Failed to load: ${esc(String(e))}</p>`;
});

// The wordmark's barcode, seeded by the page's name; the same generator the
// landing page and the pad use (never the publisher's own code).
document.getElementById('ref-code')?.insertAdjacentHTML('afterbegin', barcodeSvg('EMBER Reference', 'ref-code'));
