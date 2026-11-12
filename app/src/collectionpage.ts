// MY COLLECTION (/collection): the player's saved squads, saved units, built
// pieces and boxes on one page of their own (OTTO, 2026-11-11: "expand the 'My
// Collection' into multiple sections ... so players can review their saved
// units and then our tabletop and pad app can all be linked"). Picked from a
// run of mockups the same day: the HANGAR layout on a desktop (squad list on
// the left, the open squad as one bay per mech with its cards laid out) and
// the CARD GRID on a phone (a squad's cards three to a row under each mech).
//
// It owns no data. The squads are squadstore.ts, the units presets.ts, the
// built pieces and boxes collection.ts, and library.ts / collection.ts carry
// them to the account, so a squad saved here is on the pad and the tabletop of
// every device the player signs in on. The Tabletop and the Pad still take a
// squad by its id in the address (?squad=, main.ts and pad.ts), but the page
// no longer links to them from a squad (OTTO, 2026-11-11: "remove the play on
// tabletop and pad buttons"); the squad is simply there when they open.
import './reference.css';
import './partpicker.css';
import './collectionpage.css';
import type { Card, MechLoadout } from './types';
import { boxCoverUrl, cardImageUrl, cardName, FACTION_LABEL, isListedBox, loadData, mechArtLayers, type GameData } from './data';
import { EmberApi } from './api';
import { bindLibrary, librarySync, onLibrary } from './library';
import { bindCollection, loadCollection, onCollection, saveCollection } from './collection';
import {
  deleteSquad, isBuiltInSquad, loadoutFaction, loadoutPoints, loadSquads, savedSquadPoints, squadCap, updateSquad,
  SQUAD_CAPS, type SavedSquad,
} from './squadstore';
import { deleteMechPreset, isBuiltInPreset, loadMechPresets, updateMechPreset, type MechPreset } from './presets';
import { hiddenBuiltIns, restoreBuiltIns } from './builtins';
import { BUILD_SLOTS, buildDefaultName, confirmLegalBuild, mechBuilderHtml, openMechSlot, slotPool } from './mechbuilder';
import { fillPortraits } from './cardart';
import { openCardSheet, useSheetData } from './cardsheet';
import { carryMechEdit, linksOf, linksSummary } from './mechlinks';
import { squadImageName, squadImagePng } from './squadimage';
import { choiceDialog, confirmDialog, promptDialog } from './dialog';
import { printsWide } from './images';
import { registerOffline } from './offline';

type Tab = 'squads' | 'units' | 'built' | 'boxes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'squads', label: 'Squads' },
  { id: 'units', label: 'Units' },
  { id: 'built', label: 'Built pieces' },
  { id: 'boxes', label: 'Boxes' },
];
const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];
const SLOT_LABEL: Record<string, string> = Object.fromEntries(BUILD_SLOTS.map((s) => [s.key, s.label]));
const PREF = 'ember-collection-page-v1';

const root = document.getElementById('cl-root')!;
const api = new EmberApi();
let data: GameData | null = null;
let loadError = '';

// What the viewer was looking at, kept per browser so a reload opens where
// they left off. Never anything that must survive: the stores hold that.
const view = {
  tab: 'squads' as Tab,
  squad: '',
  capFilter: 0,
  // The squad list's and the units' faction filters (OTTO, 2026-11-12), '' for all.
  facFilter: '',
  unitFac: '',
  // The phone shows a squad full screen; the desktop beside its list.
  phoneOpen: false,
  piecesQuery: '',
  boxFaction: '',
  // The unit open in the builder drawer: a copy, saved only on Save.
  // `target` is set when the drawer was opened from a squad's "Add a mech":
  // the mech goes into that squad (or a new one by that name) on Add.
  // `edit` is set when the drawer edits a mech INSIDE a squad: that squad and
  // its place in it. `was` is the build as it opened, so the save can carry the
  // change to every other place holding the same build (mechlinks.ts).
  unit: null as null | {
    id: string; name: string; mech: MechLoadout; builtIn: boolean; was?: MechLoadout;
    target?: { squad?: string; newName?: string };
    edit?: { squad: string; index: number };
  },
};
try {
  const raw = JSON.parse(localStorage.getItem(PREF) ?? '{}') as Partial<typeof view>;
  if (raw.tab && TABS.some((t) => t.id === raw.tab)) view.tab = raw.tab;
  if (typeof raw.squad === 'string') view.squad = raw.squad;
  if (typeof raw.capFilter === 'number') view.capFilter = raw.capFilter;
  if (typeof raw.facFilter === 'string') view.facFilter = raw.facFilter;
  if (typeof raw.unitFac === 'string') view.unitFac = raw.unitFac;
} catch {
  // Storage blocked or garbled: the defaults.
}
function remember(): void {
  try {
    localStorage.setItem(PREF, JSON.stringify({ tab: view.tab, squad: view.squad, capFilter: view.capFilter, facFilter: view.facFilter, unitFac: view.unitFac }));
  } catch {
    // Storage blocked: the page still works, it just forgets.
  }
}

const phoneQuery = window.matchMedia('(max-width: 860px)');
const isPhone = (): boolean => phoneQuery.matches;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const FAC_SHORT: Record<string, string> = { RDL: 'RDL', UN: 'UN', GOF: 'GoF', PD: 'PD', COLLABORATION: 'Collab' };
const facTag = (f: string | null): string => (f ? `<span class="cl-fac" data-fac="${esc(f)}">${esc(FAC_SHORT[f] ?? f)}</span>` : '');

// ---------- reading a squad ----------

interface SquadView {
  sq: SavedSquad;
  points: number;
  cap: number;
  faction: string | null;
  factions: string[];
  builtIn: boolean;
}

function squadFaction(d: GameData, sq: SavedSquad): { main: string | null; all: string[] } {
  const all = new Set<string>();
  for (const m of sq.mechs) {
    const f = loadoutFaction(d, m.loadout);
    if (f) all.add(f);
  }
  for (const dr of sq.drones) {
    const c = d.byId.get(dr.cardId);
    const f = c ? d.factionOf(c) : null;
    if (f) all.add(f);
  }
  const first = sq.mechs[0] ? loadoutFaction(d, sq.mechs[0].loadout) : null;
  return { main: first ?? [...all][0] ?? null, all: [...all] };
}

function squadViews(d: GameData): SquadView[] {
  return loadSquads()
    .map((sq) => {
      const points = savedSquadPoints(d, sq);
      const f = squadFaction(d, sq);
      return { sq, points, cap: squadCap(sq, points), faction: f.main, factions: f.all, builtIn: isBuiltInSquad(sq.id) };
    })
    // The player's own first, newest on top; the shipped starters after.
    .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || b.sq.saved - a.sq.saved || a.sq.name.localeCompare(b.sq.name));
}

// What the squad's header says about it: the cap, mixed factions, a mech
// missing a core Part or its pilot. Warned, never blocked (the house rule).
function squadIssues(d: GameData, v: SquadView): string[] {
  const out: string[] = [];
  if (v.points > v.cap) out.push(`${v.points - v.cap}p over ${v.cap}`);
  if (v.factions.length > 1) out.push(`mixes ${v.factions.map((f) => FAC_SHORT[f] ?? f).join(' + ')}`);
  for (const m of v.sq.mechs) {
    if (!m.loadout.torso || !m.loadout.chasis || !(m.loadout.leftHand || m.loadout.rightHand)) { out.push('a mech is missing a core part'); break; }
  }
  if (v.sq.mechs.some((m) => !m.loadout.pilot)) out.push('a mech has no pilot');
  void d;
  return out;
}

function mechName(d: GameData, m: { name?: string; loadout: MechLoadout }): string {
  return m.name?.trim() || buildDefaultName(d, m.loadout) || 'Unnamed mech';
}

// ---------- drawing pieces ----------

// The mech's picture from its Parts, back to front: the board's own stack
// (data.ts mechArtLayers). A Part with no layer art simply drops out.
function mechArt(m: MechLoadout, cls = ''): string {
  const layers = mechArtLayers(m);
  return `<div class="cl-mech ${cls}">${layers.map((u) => `<img class="cl-layer" src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>`;
}

function cardTile(d: GameData, id: string, label = '', extra = ''): string {
  const c = d.byId.get(id);
  const wide = c ? printsWide(c) : false;
  const name = c ? cardName(c) : id;
  return `<button type="button" class="cl-card${wide ? ' wide' : ''} ${extra}" data-act="zoom" data-id="${esc(id)}" title="${esc(name)}">
    <img class="cl-cardimg" src="${esc(cardImageUrl(id))}" alt="${esc(name)}" loading="lazy" data-name="${esc(name)}">
    ${label ? `<span class="cl-slot">${esc(label)}</span>` : ''}
  </button>`;
}

// One slot of a mech in a squad (OTTO, 2026-11-11: "easier to remove or swap
// out parts of existing mechs inside of a squad"): the card, which opens the
// Reference's sheet for it, and under it Swap, Details and Remove. An empty
// slot is itself the way to fill it.
function bayCard(d: GameData, sqId: string, i: number, k: keyof MechLoadout, id: string | undefined, label: boolean): string {
  const at = `data-id="${esc(sqId)}" data-i="${i}" data-slot="${k}"`;
  if (!id) {
    return `<div class="cl-bc"><button type="button" class="cl-card empty add" data-act="slot-swap" ${at} title="Add a ${esc(SLOT_LABEL[k])}"><span class="cl-plus">+</span><span class="cl-slot">${esc(SLOT_LABEL[k])}</span></button></div>`;
  }
  return `<div class="cl-bc">${cardTile(d, id, label ? SLOT_LABEL[k] : '')}
    <div class="cl-bc-acts">
      <button type="button" data-act="slot-swap" ${at} title="Swap this ${esc(SLOT_LABEL[k])}" aria-label="Swap">${ICON.swap}</button>
      <button type="button" data-act="read" data-id="${esc(id)}" title="Card details, as on the Reference" aria-label="Card details">${ICON.info}</button>
      <button type="button" class="rm" data-act="slot-remove" ${at} title="Remove this ${esc(SLOT_LABEL[k])}" aria-label="Remove">✕</button>
    </div></div>`;
}

// The points gauge: one cell per 50 points of the cap, the last part-filled.
function gauge(points: number, cap: number): string {
  const cells = Math.round(cap / 50);
  const filled = points / 50;
  let h = '';
  for (let i = 0; i < cells; i++) {
    if (i + 1 <= filled) h += '<i class="f"></i>';
    else if (i < filled) h += `<i class="p" style="--part:${Math.round((filled - i) * 100)}%"></i>`;
    else h += '<i></i>';
  }
  const over = points > cap;
  return `<div class="cl-gauge${over ? ' over' : ''}" role="img" aria-label="${points} of ${cap} points">${h}</div>`;
}

function capSeg(current: number, act: string, withAll = false): string {
  const opts: [number, string][] = [...(withAll ? [[0, 'All'] as [number, string]] : []), ...SQUAD_CAPS.map((c) => [c, String(c)] as [number, string])];
  return `<div class="cl-seg" role="group">${opts.map(([c, l]) => `<button type="button" class="${c === current ? 'on' : ''}" data-act="${act}" data-cap="${c}" aria-pressed="${c === current}">${l}</button>`).join('')}</div>`;
}

const ICON = {
  image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.8" cy="6" r="1.2"/><path d="M14 10.5l-3.5-3.5L4 13.5"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8H2.5v-3z"/></svg>',
  dup: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>',
  bin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/></svg>',
  swap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h9l-2.5-2.5M13 11H4l2.5 2.5"/></svg>',
  info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 5v.01"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>',
};

function syncChip(): string {
  const who = api.user;
  if (!who) {
    return `<a class="cl-sync off" href="../pad/" title="Sign in on the Pad to keep your squads on every device"><span class="dot"></span>On this device only <em>· sign in to sync</em></a>`;
  }
  const s = librarySync();
  if (s.unsent) return `<span class="cl-sync wait"><span class="dot"></span>Saving to your account…</span>`;
  const when = s.updatedAt ? ago(s.updatedAt) : '';
  return `<span class="cl-sync"><span class="dot"></span>Synced to ${esc(who.username)} <em>· desktop + phone${when ? ` · ${when}` : ''}</em></span>`;
}

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---------- the page ----------

function render(): void {
  const scrollY = window.scrollY;
  if (!data) {
    root.innerHTML = `<div class="cl-page"><p class="cl-loading">${loadError ? esc(loadError) : 'Loading your collection…'}</p></div>`;
    return;
  }
  const d = data;
  const squads = squadViews(d);
  const units = loadMechPresets();
  const col = loadCollection();
  const pieces = Object.values(col.cards).reduce((a, n) => a + n, 0);
  const boxes = Object.values(col.boxes).reduce((a, n) => a + n, 0);
  const counts: Record<Tab, number> = { squads: squads.length, units: units.length, built: pieces, boxes };
  const phone = isPhone();
  const openSquad = squads.find((v) => v.sq.id === view.squad) ?? null;

  // The phone's open squad is its own screen, with its own header.
  if (phone && view.tab === 'squads' && view.phoneOpen && openSquad) {
    root.innerHTML = `<div class="cl-page cl-phone">${phoneSquadHtml(d, openSquad)}</div>`;
    after();
    return;
  }

  const newBtn = view.tab === 'units'
    ? `<button type="button" class="cl-btn pri" data-act="unit-new">+ New unit</button>`
    : view.tab === 'squads' ? `<button type="button" class="cl-btn pri" data-act="squad-new">+ New squad</button>` : '';
  const head = `<header class="cl-top">
      <a class="ui-home" href="../"><b>‹</b>EMBER</a>
      <span class="cl-sys"><b>COL</b> // MY COLLECTION</span>
      <span class="cl-grow"></span>
      ${phone ? '' : syncChip()}
    </header>
    <div class="cl-titlerow">
      <div><div class="cl-eyebrow">YOUR HANGAR</div><h1>My <span>Collection</span></h1></div>
      <span class="cl-grow"></span>${newBtn}
    </div>
    ${phone ? `<div class="cl-phsync">${syncChip()}</div>` : ''}
    <div class="cl-tabwrap">
      <nav class="ref-tabs cl-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="${t.id === view.tab ? 'active' : ''}" aria-selected="${t.id === view.tab}" data-act="tab" data-tab="${t.id}">${esc(t.label)}<span class="tab-n">${counts[t.id]}</span></button>`).join('')}</nav>
      ${view.tab === 'units' ? unitFacetsHtml(d, units) : ''}
    </div>`;

  let body = '';
  if (view.tab === 'squads') body = phone ? phoneSquadListHtml(d, squads) : hangarHtml(d, squads, openSquad);
  else if (view.tab === 'units') body = unitsHtml(d, units, squads);
  else if (view.tab === 'built') body = piecesHtml(d);
  else body = boxesHtml(d);

  root.innerHTML = `<div class="cl-page${phone ? ' cl-phone' : ''}"><span class="cl-corner tl"></span><span class="cl-corner tr"></span>${head}${body}</div>${view.unit ? unitDrawerHtml(d) : ''}`;
  after();
  window.scrollTo(0, scrollY);
}

function after(): void {
  fillPortraits(root, true);
  // The squad list is as wide as the tab row above it, so the two line up
  // (OTTO, 2026-11-12: "uniform design so those two spaces would line up").
  // Measured, because the tabs' width follows their counts.
  const tabs = root.querySelector<HTMLElement>('.cl-tabs');
  const page = root.querySelector<HTMLElement>('.cl-page');
  if (tabs && page) page.style.setProperty('--cl-tabs-w', `${Math.ceil(tabs.getBoundingClientRect().width)}px`);
  const search = root.querySelector<HTMLInputElement>('.cl-search[data-act="pieces-q"]');
  if (search && document.activeElement !== search && view.piecesQuery) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

// ---------- squads: the hangar (desktop) ----------

function squadTile(v: SquadView, on: boolean): string {
  const sq = v.sq;
  // The first two only (OTTO, 2026-11-11: more "starts to bunch things up").
  const mechs = sq.mechs.slice(0, 2);
  const n = `${sq.mechs.length} mech${sq.mechs.length === 1 ? '' : 's'}${sq.drones.length ? ` · ${sq.drones.length} drone${sq.drones.length === 1 ? '' : 's'}` : ''}`;
  return `<button type="button" class="cl-tile${on ? ' on' : ''}" data-fac="${esc(v.faction ?? '')}" data-act="squad-open" data-id="${esc(sq.id)}">
    <span class="cl-tile-mechs">${mechs.map((m) => mechArt(m.loadout)).join('')}</span>
    <span class="cl-tile-tx">
      <span class="cl-tile-tags">${facTag(v.faction)}${v.builtIn ? '<span class="cl-tag">starter</span>' : ''}</span>
      <span class="cl-tile-name">${esc(sq.name)}</span>
      <span class="cl-tile-sub">${n}</span>
    </span>
    <span class="cl-tile-ft">${gauge(v.points, v.cap)}<span class="cl-pts${v.points > v.cap ? ' over' : ''}">${v.points}<i>/${v.cap}</i></span></span>
  </button>`;
}

const SQUAD_FACS = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'];
const inFaction = (v: SquadView, f: string): boolean => v.faction === f || v.factions.includes(f);
const bySize = (squads: SquadView[]): SquadView[] => (view.capFilter ? squads.filter((v) => v.cap === view.capFilter) : squads);

function filtered(squads: SquadView[]): SquadView[] {
  const sized = bySize(squads);
  return view.facFilter ? sized.filter((v) => inFaction(v, view.facFilter)) : sized;
}

// The faction row (OTTO, 2026-11-12: "if there are a ton of squads we can
// click RDL or UN to only show those"): the Reference's facets, counted within
// the game size picked, offering only the factions the player has squads of.
function facetsHtml(squads: SquadView[]): string {
  const sized = bySize(squads);
  const facs = SQUAD_FACS.filter((f) => squads.some((v) => inFaction(v, f)) || view.facFilter === f);
  return facetRow('fac-filter', view.facFilter, sized.length, facs.map((f) => ({ f, n: sized.filter((v) => inFaction(v, f)).length })));
}

// One row of faction buttons, all the same width and filling the row
// (OTTO, 2026-11-12), shared by Squads and Units.
function facetRow(act: string, current: string, all: number, facs: { f: string; n: number }[]): string {
  if (!facs.length) return '';
  // The Reference's own buttons: a faction's colour shows when it is picked.
  const btn = (f: string, label: string, n: number): string => `<button type="button" class="ref-facet${current === f ? ' active' : ''}"${f ? ` data-fac="${esc(f)}"` : ''} data-act="${act}" data-fac-pick="${esc(f)}" aria-pressed="${current === f}">${esc(label)} <span class="fc-n">${n}</span></button>`;
  return `<div class="ref-facets cl-facets" role="group" aria-label="Faction">
    ${btn('', 'All', all)}${facs.map((x) => btn(x.f, FACTION_LABEL[x.f] ?? x.f, x.n)).join('')}
  </div>`;
}

function emptyFilterText(): string {
  const fac = view.facFilter ? `${FAC_SHORT[view.facFilter] ?? view.facFilter} ` : '';
  return view.capFilter ? `No ${fac}squads saved for ${view.capFilter} points yet.` : `No ${fac}squads saved yet.`;
}

function hangarHtml(d: GameData, squads: SquadView[], open: SquadView | null): string {
  const list = filtered(squads);
  const sel = open && list.includes(open) ? open : list[0] ?? null;
  if (sel) view.squad = sel.sq.id;
  const hidden = hiddenBuiltIns().length;
  return `<div class="cl-hangar">
    <aside class="cl-list">
      <div class="cl-listhead"><span class="cl-lbl">Game size</span>${capSeg(view.capFilter, 'cap-filter', true)}</div>
      ${facetsHtml(squads)}
      ${list.length ? list.map((v) => squadTile(v, v === sel)).join('') : `<p class="cl-empty">${esc(emptyFilterText())}</p>`}
      ${hidden ? `<button type="button" class="cl-link" data-act="restore">Show the built-in starters again (${hidden})</button>` : ''}
    </aside>
    <section class="cl-main">${sel ? squadDetailHtml(d, sel) : emptySquadsHtml()}</section>
  </div>`;
}

function emptySquadsHtml(): string {
  return `<div class="cl-blank"><h2>No squad yet</h2><p>Build units on the Units tab, then put them together here. Squads you save on the Pad or the Tabletop show up here too.</p>
    <button type="button" class="cl-btn pri" data-act="squad-new">+ New squad</button></div>`;
}

function squadActions(v: SquadView): string {
  const id = esc(v.sq.id);
  return `<button type="button" class="cl-btn" data-act="squad-image" data-id="${id}" title="Save the squad as one picture, with the squad inside it to import">${ICON.image} Save image</button>
    <button type="button" class="cl-btn" data-act="squad-rename" data-id="${id}">${ICON.edit} Rename</button>
    <button type="button" class="cl-btn icon" data-act="squad-dup" data-id="${id}" title="Duplicate" aria-label="Duplicate">${ICON.dup}</button>
    <button type="button" class="cl-btn icon" data-act="squad-del" data-id="${id}" title="${v.builtIn ? 'Put away' : 'Delete'}" aria-label="Delete">${ICON.bin}</button>`;
}

function squadDetailHtml(d: GameData, v: SquadView): string {
  const sq = v.sq;
  const issues = squadIssues(d, v);
  const dronePts = sq.drones.reduce((n, x) => n + (d.byId.get(x.cardId)?.score ?? 0) + (x.backpack ? d.byId.get(x.backpack)?.score ?? 0 : 0), 0);
  const tacPts = (sq.tactics ?? []).reduce((n, id) => n + (d.byId.get(id)?.score ?? 0), 0);
  const bays = sq.mechs.map((m, i) => {
    const f = loadoutFaction(d, m.loadout);
    const pilot = m.loadout.pilot ? d.byId.get(m.loadout.pilot) : undefined;
    return `<article class="cl-bay">
      <div class="cl-plate" data-fac="${esc(f ?? '')}">
        <div class="cl-bay-top"><span class="cl-lbl">Mech ${i + 1}</span><span class="cl-pts">${loadoutPoints(d, m.loadout)}<i>p</i></span></div>
        ${mechArt(m.loadout)}
        <div class="cl-bay-foot"><div class="cl-bay-name"><b>${esc(mechName(d, m))}</b><span class="cl-lbl" title="${pilot ? esc(cardName(pilot)) : ''}">${pilot ? `Pilot · ${esc(cardName(pilot))}` : 'No pilot'}</span></div>
        <button type="button" class="cl-ico cl-bay-edit" data-act="mech-edit" data-id="${esc(sq.id)}" data-i="${i}" title="Edit this mech" aria-label="Edit ${esc(mechName(d, m))}">${ICON.edit}</button></div>
        <button type="button" class="ui-x cl-bay-x" data-act="mech-remove" data-id="${esc(sq.id)}" data-i="${i}" title="Take this mech out of the squad" aria-label="Take ${esc(mechName(d, m))} out">✕</button>
      </div>
      <div class="cl-bay-cards">${SLOTS.map((k) => bayCard(d, sq.id, i, k, m.loadout[k], true)).join('')}</div>
    </article>`;
  }).join('');
  const drones = sq.drones.length ? `<div class="cl-sec"><span class="cl-lbl">Drones · ${dronePts}p</span></div>
    <div class="cl-row-wide">${sq.drones.map((x) => cardTile(d, x.cardId) + (x.backpack ? cardTile(d, x.backpack) : '')).join('')}</div>` : '';
  const tactics = sq.tactics?.length ? `<div class="cl-sec"><span class="cl-lbl">Tactics cards · ${tacPts}p</span></div>
    <div class="cl-row-tac">${sq.tactics.map((id) => cardTile(d, id)).join('')}</div>` : '';
  return `<div class="cl-head" data-fac="${esc(v.faction ?? '')}">
      <div class="cl-head-l">
        <div class="cl-head-tags">${facTag(v.faction)}${v.builtIn ? '<span class="cl-tag">starter</span>' : ''}
          ${issues.length ? `<span class="cl-warn">${esc(issues.join(' · '))}</span>` : '<span class="cl-ok">✓ Legal</span>'}</div>
        <h2>${esc(sq.name)}</h2>
        <div class="cl-head-gauge">${gauge(v.points, v.cap)}</div>
        <div class="cl-stats">
          <div><span class="cl-lbl">Points</span><b class="${v.points > v.cap ? 'over' : ''}">${v.points}<i>/${v.cap}</i></b></div>
          <div><span class="cl-lbl">Mechs</span><b>${sq.mechs.length}</b></div>
          <div><span class="cl-lbl">Drones</span><b>${sq.drones.length}</b></div>
          <div><span class="cl-lbl">Free</span><b>${Math.max(0, v.cap - v.points)}<i>p</i></b></div>
          <div class="cl-capbox"><span class="cl-lbl">Built for</span>${capSeg(v.cap, 'squad-cap')}</div>
        </div>
      </div>
      <div class="cl-actions">${squadActions(v)}</div>
    </div>
    ${bays}
    ${drones}${tactics}
    <button type="button" class="cl-addbay" data-act="mech-add" data-id="${esc(sq.id)}">+ Add a mech <em>build a new one or pick a saved unit</em></button>`;
}

// ---------- squads: the phone ----------

function phoneSquadListHtml(d: GameData, squads: SquadView[]): string {
  void d;
  const list = filtered(squads);
  const hidden = hiddenBuiltIns().length;
  return `<div class="cl-phlist">
    <div class="cl-listhead"><span class="cl-lbl">Game size</span>${capSeg(view.capFilter, 'cap-filter', true)}</div>
    ${facetsHtml(squads)}
    ${list.length ? list.map((v) => squadTile(v, false)).join('') : squads.length ? `<p class="cl-empty">${esc(emptyFilterText())}</p>` : emptySquadsHtml()}
    ${hidden ? `<button type="button" class="cl-link" data-act="restore">Show the built-in starters again (${hidden})</button>` : ''}
  </div>`;
}

function phoneSquadHtml(d: GameData, v: SquadView): string {
  const sq = v.sq;
  const issues = squadIssues(d, v);
  const mechs = sq.mechs.map((m, i) => `<div class="cl-div"><span>${esc(mechName(d, m))}</span><b>${loadoutPoints(d, m.loadout)}p</b>
      <button type="button" class="ui-x" data-act="mech-remove" data-id="${esc(sq.id)}" data-i="${i}" aria-label="Take ${esc(mechName(d, m))} out">✕</button></div>
    <div class="cl-phmech" data-fac="${esc(loadoutFaction(d, m.loadout) ?? '')}">${mechArt(m.loadout)}
      <button type="button" class="cl-ico cl-phedit" data-act="mech-edit" data-id="${esc(sq.id)}" data-i="${i}" title="Edit this mech" aria-label="Edit ${esc(mechName(d, m))}">${ICON.edit}</button></div>
    <div class="cl-grid3">${SLOTS.map((k) => bayCard(d, sq.id, i, k, m.loadout[k], false)).join('')}</div>`).join('');
  const drones = sq.drones.length ? `<div class="cl-div"><span>Drones</span><b>${sq.drones.reduce((n, x) => n + (d.byId.get(x.cardId)?.score ?? 0), 0)}p</b></div>
    <div class="cl-grid2">${sq.drones.map((x) => cardTile(d, x.cardId)).join('')}</div>` : '';
  const tactics = sq.tactics?.length ? `<div class="cl-div"><span>Tactics</span></div><div class="cl-grid3">${sq.tactics.map((id) => cardTile(d, id)).join('')}</div>` : '';
  return `<header class="cl-phhead">
      <button type="button" class="ui-home" data-act="phone-back" aria-label="Back to squads"><b>‹</b>SQUADS</button>
      <h2>${esc(sq.name)}</h2>
    </header>
    <div class="cl-phbody" data-fac="${esc(v.faction ?? '')}">
      <div class="cl-phmeta">${facTag(v.faction)}${issues.length ? `<span class="cl-warn">${esc(issues.join(' · '))}</span>` : '<span class="cl-ok">✓ Legal</span>'}<span class="cl-grow"></span>${capSeg(v.cap, 'squad-cap')}</div>
      <div class="cl-phpts"><span class="cl-pts big${v.points > v.cap ? ' over' : ''}">${v.points}<i>/${v.cap}</i></span>${gauge(v.points, v.cap)}</div>
      ${mechs}${drones}${tactics}
    </div>
    <div class="cl-sticky">
      <button type="button" class="cl-btn pri" data-act="mech-add" data-id="${esc(sq.id)}">+ Add a mech</button>
      <button type="button" class="cl-btn icon" data-act="squad-more" data-id="${esc(sq.id)}" aria-label="More">${ICON.more}</button>
    </div>`;
}

// ---------- units ----------

function unitsHtml(d: GameData, units: MechPreset[], squads: SquadView[]): string {
  const sameMech = (a: MechLoadout, b: MechLoadout) => SLOTS.every((k) => (a[k] ?? '') === (b[k] ?? ''));
  const facOf = new Map(units.map((u) => [u.id, loadoutFaction(d, u.mech)]));
  const shown = view.unitFac ? units.filter((u) => facOf.get(u.id) === view.unitFac) : units;
  const tiles = shown
    .slice()
    .sort((a, b) => Number(isBuiltInPreset(a.id)) - Number(isBuiltInPreset(b.id)) || b.saved - a.saved || a.name.localeCompare(b.name))
    .map((u) => {
      const f = loadoutFaction(d, u.mech);
      const pilot = u.mech.pilot ? d.byId.get(u.mech.pilot) : undefined;
      const inSq = squads.filter((v) => v.sq.mechs.some((m) => sameMech(m.loadout, u.mech))).length;
      return `<button type="button" class="cl-unit" data-act="unit-open" data-id="${esc(u.id)}">
        <span class="cl-plate" data-fac="${esc(f ?? '')}">${mechArt(u.mech)}
          <span class="cl-unit-tags">${facTag(f)}${isBuiltInPreset(u.id) ? '<span class="cl-tag">starter</span>' : ''}</span>
          <span class="cl-pts">${loadoutPoints(d, u.mech)}<i>p</i></span></span>
        <span class="cl-strip">${SLOTS.map((k) => (u.mech[k] ? `<img class="cl-cardimg" src="${esc(cardImageUrl(u.mech[k]!))}" alt="" loading="lazy" data-name="">` : '<i></i>')).join('')}</span>
        <span class="cl-unit-meta"><b>${esc(u.name)}</b><span><span>${pilot ? esc(cardName(pilot)) : 'No pilot'}</span><span>${inSq ? `in ${inSq} squad${inSq === 1 ? '' : 's'}` : 'not in a squad'}</span></span></span>
      </button>`;
    }).join('');
  return `<div class="cl-units">${tiles}<button type="button" class="cl-unit new" data-act="unit-new">+ Build a unit</button></div>`;
}

// The Units tab's faction row. It sits under the tabs and takes their width
// (OTTO, 2026-11-12), so the header draws it.
function unitFacetsHtml(d: GameData, units: MechPreset[]): string {
  const facOf = new Map(units.map((u) => [u.id, loadoutFaction(d, u.mech)]));
  const facs = SQUAD_FACS.filter((f) => units.some((u) => facOf.get(u.id) === f) || view.unitFac === f)
    .map((f) => ({ f, n: units.filter((u) => facOf.get(u.id) === f).length }));
  return facetRow('unit-fac', view.unitFac, units.length, facs);
}

function unitDrawerHtml(d: GameData): string {
  const u = view.unit!;
  const f = loadoutFaction(d, u.mech);
  return `<div class="cl-drawer-back" data-act="unit-close"></div>
  <aside class="cl-drawer" role="dialog" aria-label="Unit builder">
    <button type="button" class="dlg-close" data-act="unit-close" aria-label="Close">✕</button>
    <div class="cl-plate cl-drawer-art" data-fac="${esc(f ?? '')}">${mechArt(u.mech)}</div>
    <div class="cl-drawer-body mech-bench">${mechBuilderHtml(d, u.mech, { name: u.name || buildDefaultName(d, u.mech) || (u.target ? 'New mech' : 'New unit') })}</div>
    <div class="cl-drawer-actions">
      ${u.edit ? editActionsHtml(u) : u.target ? `<div class="cl-drawer-for"><span class="cl-lbl">Building for</span><b>${esc(u.target.newName ?? loadSquads().find((s) => s.id === u.target!.squad)?.name ?? 'a squad')}</b></div>
      <button type="button" class="cl-btn pri" data-act="unit-add-target">Add to squad</button>
      <button type="button" class="cl-btn" data-act="unit-add-target" data-keep="1">Add and save as a unit</button>` : `
      ${u.id && !u.builtIn ? (() => { const also = linksSummary(linksOf(loadMechPresets().find((p) => p.id === u.id)?.mech ?? {}, { unit: u.id })); return also ? `<p class="cl-drawer-also">Saving also updates ${esc(also)}.</p>` : ''; })() : ''}
      <button type="button" class="cl-btn pri" data-act="unit-save">${u.builtIn ? 'Save as my unit' : u.id ? 'Save' : 'Save unit'}</button>
      ${u.id ? `<button type="button" class="cl-btn" data-act="unit-to-squad">Add to a squad</button>` : ''}
      ${u.id && !u.builtIn ? `<button type="button" class="cl-btn" data-act="unit-copy">Save as copy</button>` : ''}
      <span class="cl-grow"></span>
      ${u.id ? `<button type="button" class="cl-btn icon" data-act="unit-del" title="${u.builtIn ? 'Put away' : 'Delete'}" aria-label="Delete">${ICON.bin}</button>` : ''}`}
    </div>
  </aside>`;
}

// The drawer's foot while it edits a mech inside a squad: what the save will
// also change, so carrying the edit to the saved unit is never a surprise.
function editActionsHtml(u: NonNullable<typeof view.unit>): string {
  const sq = findSquad(u.edit!.squad);
  const also = linksSummary(linksOf(u.was ?? {}, { squad: u.edit!.squad, index: u.edit!.index }));
  return `<div class="cl-drawer-for"><span class="cl-lbl">Editing in</span><b>${esc(sq?.name ?? 'a squad')}</b></div>
    ${also ? `<p class="cl-drawer-also">Saving also updates ${esc(also)}.</p>` : ''}
    <button type="button" class="cl-btn pri" data-act="mech-save">Save changes</button>
    <button type="button" class="cl-btn" data-act="unit-close">Cancel</button>`;
}

// ---------- built pieces ----------

function piecesHtml(d: GameData): string {
  const col = loadCollection();
  const held = Object.entries(col.cards)
    .map(([id, n]) => ({ card: d.byId.get(id), id, n }))
    .filter((e): e is { card: Card; id: string; n: number } => !!e.card && e.n > 0)
    .sort((a, b) => cardName(a.card).localeCompare(cardName(b.card)));
  const q = view.piecesQuery.trim().toLowerCase();
  const found = q
    ? d.cards.filter((c) => !(col.cards[c.id] > 0) && !c.referenceOnly && (cardName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q))).slice(0, 12)
    : [];
  const piece = (id: string, n: number) => `<div class="cl-piece">
      ${cardTile(d, id)}
      <div class="cl-piece-ft">${n ? `<button type="button" class="cl-step" data-act="piece-step" data-id="${esc(id)}" data-d="-1" aria-label="One fewer">−</button><b>×${n}</b>` : ''}
      <button type="button" class="cl-step" data-act="piece-step" data-id="${esc(id)}" data-d="1" aria-label="One more">+</button></div>
    </div>`;
  return `<div class="cl-pieces">
    <p class="cl-note">The models you have actually assembled. Where a card is recorded here, this count is what the Pad and the Tabletop let you field, ahead of the boxes.</p>
    <input type="search" class="cl-search" data-act="pieces-q" placeholder="Find a card to record…" value="${esc(view.piecesQuery)}">
    ${found.length ? `<div class="cl-sec"><span class="cl-lbl">Add a piece</span></div><div class="cl-piecegrid">${found.map((c) => piece(c.id, 0)).join('')}</div>` : ''}
    <div class="cl-sec"><span class="cl-lbl">${held.length ? `${held.reduce((a, e) => a + e.n, 0)} pieces recorded` : 'Nothing recorded yet'}</span></div>
    ${held.length ? `<div class="cl-piecegrid">${held.map((e) => piece(e.id, e.n)).join('')}</div>` : ''}
  </div>`;
}

// ---------- boxes ----------

// The Reference's own box tiles (reference.ts boxRow, reference.css .box-card;
// OTTO, 2026-11-11: "the boxes tab has the matching boxes styles that we use
// in the reference"): the cover bled behind a dark text plate, the name, the
// card count and the faction tags, with the owned count added to the plate.
// The faction row is the Reference's filter row too.
function boxesHtml(d: GameData): string {
  const col = loadCollection();
  const all = d.boxes.filter(isListedBox).sort((a, b) => a.id - b.id);
  const facs = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'].filter((f) => all.some((b) => (b.faction ?? []).includes(f)));
  const shown = view.boxFaction ? all.filter((b) => (b.faction ?? []).includes(view.boxFaction)) : all;
  const owned = all.reduce((n, b) => n + (col.boxes[b.key] ?? 0), 0);
  const facets = `<button type="button" class="ref-facet${view.boxFaction ? '' : ' active'}" data-act="box-fac" data-fac-pick="">All <span class="fc-n">${all.length}</span></button>`
    + facs.map((f) => {
      const n = all.filter((b) => (b.faction ?? []).includes(f)).length;
      return `<button type="button" class="ref-facet${view.boxFaction === f ? ' active' : ''}" data-fac="${esc(f)}" data-act="box-fac" data-fac-pick="${esc(f)}">${esc(FACTION_LABEL[f] ?? f)} <span class="fc-n">${n}</span></button>`;
    }).join('');
  const tile = (b: (typeof all)[number]): string => {
    const n = col.boxes[b.key] ?? 0;
    const f = (b.faction ?? [])[0];
    const inBox = d.cards.map((c) => (c.containedIn ?? []).find((e) => e.box === b.key)?.quantityPerBox ?? -1).filter((q) => q >= 0);
    const copies = inBox.reduce((a, q) => a + q, 0);
    const tags = (b.faction ?? []).map((x) => `<span class="tag">${esc(FACTION_LABEL[x] ?? x)}</span>`).join('');
    return `<article class="card-framed box-card cl-boxcard${b.hasImage ? ' has-cover' : ''}${n ? ' owned' : ''}"${f ? ` data-fac="${esc(f)}"` : ''}>
      ${b.hasImage ? `<div class="box-bleed" aria-hidden="true"><img class="cl-boxcover" src="${esc(boxCoverUrl(b.id))}" alt="" loading="lazy"></div><span class="box-scrim" aria-hidden="true"></span>` : ''}
      <div class="box-body">
        <div class="card-title">${esc(b.name.en || b.key)}</div>
        <div class="box-meta">${inBox.length} card${inBox.length === 1 ? '' : 's'} · ${copies} copies</div>
        <div class="card-badges">${n ? `<span class="tag cl-owned">Owned</span>` : ''}${tags}${b.released === false ? '<span class="tag tag-unsold">not released yet</span>' : ''}
        <span class="cl-box-own">
          <button type="button" class="cl-step" data-act="box-step" data-key="${esc(b.key)}" data-d="-1" aria-label="One fewer"${n ? '' : ' disabled'}>−</button>
          <b>${n}</b>
          <button type="button" class="cl-step" data-act="box-step" data-key="${esc(b.key)}" data-d="1" aria-label="One more">+</button>
        </span></div>
      </div>
    </article>`;
  };
  return `<div class="cl-boxwrap">
    <div class="ref-facets ref-facets-faction">${facets}</div>
    <p class="ref-count">${shown.length} box${shown.length === 1 ? '' : 'es'}${owned ? ` <small>${owned} owned</small>` : ''}</p>
    <div class="cl-boxes">${shown.map(tile).join('')}</div>
  </div>`;
}

// ---------- card reader ----------

function readCard(d: GameData, id: string): void {
  const c = d.byId.get(id);
  if (!c) return;
  const box = document.createElement('div');
  box.className = 'cl-lightbox';
  box.innerHTML = `<div class="cl-lightbox-in${printsWide(c) ? ' wide' : ''}">
      <img class="cl-cardimg" src="${esc(cardImageUrl(id))}" alt="${esc(cardName(c))}" data-name="${esc(cardName(c))}">
      <div class="cl-lightbox-ft"><b>${esc(cardName(c))}</b><span class="cl-pts">${c.score ?? 0}<i>p</i></span></div>
      <button type="button" class="dlg-close" aria-label="Close">✕</button>
    </div>`;
  const close = () => { box.remove(); document.removeEventListener('keydown', key); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', (e) => {
    if (e.target === box || (e.target as HTMLElement).closest('.dlg-close')) close();
  });
  document.addEventListener('keydown', key);
  wireImageFallbacks(box);
  document.body.appendChild(box);
}

// ---------- acting ----------

const now = (): number => Date.now();

function findSquad(id: string): SavedSquad | undefined {
  return loadSquads().find((s) => s.id === id);
}

// Where a squad's next mech comes from (OTTO, 2026-11-11: "add a brand new
// mech or a saved unit to a squad"): built from scratch in the drawer, or one
// of the saved units. "new" opens the builder; a preset goes straight in.
async function pickMech(d: GameData, title: string): Promise<'new' | MechPreset | null> {
  const units = loadMechPresets();
  const picked = await choiceDialog({
    title,
    body: units.length ? 'Build a new mech from its parts, or take one of your saved units.' : 'Build a new mech from its parts. Units you save show up here too.',
    stacked: true,
    choices: [
      { id: '__new', label: '+ Build a new mech', primary: true },
      ...units.map((u) => ({ id: u.id, label: `${u.name} · ${loadoutPoints(d, u.mech)}p` })),
      { id: 'cancel', label: 'Cancel', cancel: true },
    ],
  });
  if (picked === '__new') return 'new';
  return units.find((u) => u.id === picked) ?? null;
}

function openBuilderFor(target: { squad?: string; newName?: string }): void {
  view.unit = { id: '', name: '', mech: {}, builtIn: false, target };
  render();
}

// A change to one mech inside a squad: the squad saved, and the same build in
// saved units and other squads carried along (mechlinks.ts). A shipped squad
// becomes the player's own copy, so the page follows its new id.
function editSquadMech(sqId: string, index: number, next: MechLoadout, name?: string): void {
  const sq = findSquad(sqId);
  const m = sq?.mechs[index];
  if (!sq || !m) return;
  const t = now();
  const was = { ...m.loadout };
  const saved = updateSquad({ ...sq, mechs: sq.mechs.map((x, k) => (k === index ? { ...x, ...(name ? { name } : {}), loadout: { ...next } } : x)) }, t);
  carryMechEdit(was, next, t, { squad: saved.id, index });
  view.squad = saved.id;
  remember();
  render();
}

async function newSquad(d: GameData): Promise<void> {
  const name = await promptDialog({ title: 'Name the squad', value: '', placeholder: 'Squad name', confirmLabel: 'Next' });
  if (!name?.trim()) return;
  const first = await pickMech(d, `First mech for ${name.trim()}`);
  if (!first) return;
  if (first === 'new') { openBuilderFor({ newName: name.trim() }); return; }
  addToSquad(d, { newName: name.trim() }, first.name, first.mech);
}

// Puts a mech into the squad it was built for, or starts that squad. A new
// squad takes the smallest cap its first mech fits.
function addToSquad(d: GameData, target: { squad?: string; newName?: string }, name: string, mech: MechLoadout): void {
  let saved: SavedSquad | null = null;
  const sq = target.squad ? findSquad(target.squad) : undefined;
  if (sq) {
    saved = updateSquad({ ...sq, mechs: [...sq.mechs, { name, loadout: { ...mech } }] }, now());
  } else {
    const pts = loadoutPoints(d, mech);
    saved = updateSquad({
      id: `sq${now()}`, name: target.newName?.trim() || 'New squad', mechs: [{ name, loadout: { ...mech } }], drones: [],
      cap: SQUAD_CAPS.find((c) => pts <= c) ?? 600, saved: now(),
    }, now());
  }
  view.unit = null;
  view.tab = 'squads';
  view.squad = saved.id;
  view.phoneOpen = true;
  remember();
  render();
}

async function squadMore(d: GameData, sq: SavedSquad): Promise<void> {
  const picked = await choiceDialog({
    title: sq.name,
    sheet: true,
    choices: [
      { id: 'image', label: 'Save as image' },
      { id: 'rename', label: 'Rename' },
      { id: 'dup', label: 'Duplicate' },
      { id: 'del', label: isBuiltInSquad(sq.id) ? 'Put away' : 'Delete', danger: true },
    ],
  });
  if (picked === 'image') await saveSquadImage(d, sq);
  else if (picked === 'rename') await renameSquad(sq);
  else if (picked === 'dup') dupSquad(sq);
  else if (picked === 'del') await delSquad(sq);
}

// The squad as one PNG, drawn clean (squadimage.ts), with the squad inside it.
let savingImage = false;
async function saveSquadImage(d: GameData, sq: SavedSquad): Promise<void> {
  if (savingImage) return;
  const v = squadViews(d).find((x) => x.sq.id === sq.id);
  if (!v) return;
  savingImage = true;
  document.body.classList.add('cl-busy');
  try {
    const blob = await squadImagePng(d, {
      id: sq.id,
      name: sq.name,
      faction: v.faction,
      factionLabel: v.faction ? FAC_SHORT[v.faction] ?? v.faction : '',
      points: v.points,
      cap: v.cap,
      issues: squadIssues(d, v),
      mechs: sq.mechs.map((m) => {
        const pilot = m.loadout.pilot ? d.byId.get(m.loadout.pilot) : undefined;
        return { name: mechName(d, m), pilot: pilot ? cardName(pilot) : '', points: loadoutPoints(d, m.loadout), loadout: m.loadout, layers: mechArtLayers(m.loadout) };
      }),
      drones: sq.drones.map((x) => ({ cardId: x.cardId, ...(x.backpack ? { backpack: x.backpack } : {}) })),
      tactics: sq.tactics ?? [],
      dataVersion: d.changelog.versions[d.changelog.versions.length - 1]?.id ?? '',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = squadImageName(sq.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    await confirmDialog({ title: 'The image could not be saved', body: e instanceof Error ? e.message : String(e), confirmLabel: 'OK' });
  } finally {
    savingImage = false;
    document.body.classList.remove('cl-busy');
  }
}

async function renameSquad(sq: SavedSquad): Promise<void> {
  const name = await promptDialog({ title: 'Rename squad', value: sq.name, placeholder: 'Squad name', confirmLabel: 'Rename' });
  if (!name?.trim() || name.trim() === sq.name) return;
  const saved = updateSquad({ ...sq, name: name.trim() }, now());
  view.squad = saved.id;
  remember();
  render();
}

function dupSquad(sq: SavedSquad): void {
  const copy = updateSquad({ ...sq, id: `sq${now()}`, name: `${sq.name} (copy)`, mechs: sq.mechs.map((m) => ({ ...m, loadout: { ...m.loadout } })), drones: sq.drones.map((x) => ({ ...x })) }, now());
  view.squad = copy.id;
  remember();
  render();
}

async function delSquad(sq: SavedSquad): Promise<void> {
  const builtIn = isBuiltInSquad(sq.id);
  const ok = await confirmDialog({
    title: builtIn ? `Put away ${sq.name}?` : `Delete ${sq.name}?`,
    body: builtIn ? 'The starter squad is hidden. It can be brought back from the bottom of the list.' : 'The squad is removed from this device and your account. Its units stay on the Units tab.',
    confirmLabel: builtIn ? 'Put away' : 'Delete',
    danger: true,
  });
  if (!ok) return;
  deleteSquad(sq.id);
  view.squad = '';
  view.phoneOpen = false;
  remember();
  render();
}

async function onClick(ev: MouseEvent): Promise<void> {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || !data) return;
  const d = data;
  const act = el.dataset.act!;
  const id = el.dataset.id ?? '';
  switch (act) {
    case 'tab':
      view.tab = el.dataset.tab as Tab;
      view.phoneOpen = false;
      remember();
      render();
      window.scrollTo(0, 0);
      return;
    case 'cap-filter':
      view.capFilter = Number(el.dataset.cap);
      remember();
      render();
      return;
    case 'unit-fac':
      view.unitFac = el.dataset.facPick ?? '';
      remember();
      render();
      return;
    case 'fac-filter':
      view.facFilter = el.dataset.facPick ?? '';
      remember();
      render();
      return;
    case 'squad-open':
      view.squad = id;
      if (isPhone()) { view.phoneOpen = true; window.scrollTo(0, 0); }
      remember();
      render();
      return;
    case 'phone-back':
      view.phoneOpen = false;
      render();
      return;
    case 'squad-cap': {
      const sq = findSquad(view.squad);
      if (!sq) return;
      const saved = updateSquad({ ...sq, cap: Number(el.dataset.cap) }, now());
      view.squad = saved.id;
      remember();
      render();
      return;
    }
    case 'squad-new': await newSquad(d); return;
    case 'squad-rename': { const sq = findSquad(id); if (sq) await renameSquad(sq); return; }
    case 'squad-dup': { const sq = findSquad(id); if (sq) dupSquad(sq); return; }
    case 'squad-del': { const sq = findSquad(id); if (sq) await delSquad(sq); return; }
    case 'squad-image': { const sq = findSquad(id); if (sq) await saveSquadImage(d, sq); return; }
    case 'squad-more': { const sq = findSquad(id); if (sq) await squadMore(d, sq); return; }
    case 'restore': restoreBuiltIns(); render(); return;
    case 'mech-add': {
      const sq = findSquad(id);
      if (!sq) return;
      const u = await pickMech(d, `Add a mech to ${sq.name}`);
      if (!u) return;
      if (u === 'new') { openBuilderFor({ squad: sq.id }); return; }
      addToSquad(d, { squad: sq.id }, u.name, u.mech);
      return;
    }
    case 'mech-save': {
      const u = view.unit;
      if (!u?.edit) return;
      if (!(await confirmLegalBuild(d, u.mech, 'Save anyway'))) return;
      const { squad, index } = u.edit;
      view.unit = null;
      editSquadMech(squad, index, u.mech, u.name.trim() || undefined);
      return;
    }
    case 'unit-add-target': {
      const u = view.unit;
      if (!u?.target) return;
      if (!(await confirmLegalBuild(d, u.mech, 'Add anyway'))) return;
      const name = u.name.trim() || buildDefaultName(d, u.mech) || 'New mech';
      if (el.dataset.keep) updateMechPreset({ id: '', name, mech: u.mech, saved: now() }, now());
      addToSquad(d, u.target, name, u.mech);
      return;
    }
    case 'mech-remove': {
      const sq = findSquad(id);
      const i = Number(el.dataset.i);
      const m = sq?.mechs[i];
      if (!sq || !m) return;
      if (sq.mechs.length + sq.drones.length <= 1) {
        await choiceDialog({ title: 'That is the last unit', body: 'A squad needs at least one unit. Delete the squad instead if you no longer want it.', choices: [{ id: 'ok', label: 'Got it' }] });
        return;
      }
      const ok = await confirmDialog({ title: `Take ${mechName(d, m)} out of ${sq.name}?`, body: 'The unit stays on the Units tab if it is saved there.', confirmLabel: 'Take out', danger: true });
      if (!ok) return;
      const saved = updateSquad({ ...sq, mechs: sq.mechs.filter((_, k) => k !== i) }, now());
      view.squad = saved.id;
      remember();
      render();
      return;
    }
    // The card itself enlarges its picture; the Details button (and the
    // builder's i) opens the Reference's sheet (OTTO, 2026-11-12).
    case 'zoom': readCard(d, id); return;
    case 'read': if (!openCardSheet(id)) readCard(d, id); return;
    case 'mech-edit': {
      const sq = findSquad(id);
      const i = Number(el.dataset.i);
      const m = sq?.mechs[i];
      if (!sq || !m) return;
      view.unit = { id: '', name: mechName(d, m), mech: { ...m.loadout }, builtIn: false, was: { ...m.loadout }, edit: { squad: sq.id, index: i } };
      render();
      return;
    }
    case 'slot-swap': {
      const sq = findSquad(id);
      const i = Number(el.dataset.i);
      const m = sq?.mechs[i];
      const slot = BUILD_SLOTS.find((s) => s.key === el.dataset.slot);
      if (!sq || !m || !slot) return;
      openMechSlot({
        data: d, loadout: m.loadout, slot, cards: slotPool(d, slot, m.loadout[slot.key]), unitName: mechName(d, m),
        actionLabel: m.loadout[slot.key] ? `Swap in` : `Add ${slot.label}`,
        onPick: (card) => { editSquadMech(sq.id, i, { ...m.loadout, [slot.key]: card.id }); },
      });
      return;
    }
    case 'slot-remove': {
      const sq = findSquad(id);
      const i = Number(el.dataset.i);
      const m = sq?.mechs[i];
      const key = el.dataset.slot as keyof MechLoadout;
      if (!sq || !m || !m.loadout[key]) return;
      const next = { ...m.loadout };
      delete next[key];
      editSquadMech(sq.id, i, next);
      return;
    }
    case 'unit-new':
      view.unit = { id: '', name: '', mech: {}, builtIn: false };
      render();
      return;
    case 'unit-open': {
      const u = loadMechPresets().find((p) => p.id === id);
      if (!u) return;
      view.unit = { id: u.id, name: u.name, mech: { ...u.mech }, builtIn: isBuiltInPreset(u.id) };
      render();
      return;
    }
    case 'unit-close': view.unit = null; render(); return;
    case 'build-slot': {
      const u = view.unit;
      const slot = BUILD_SLOTS.find((s) => s.key === el.dataset.slot);
      if (!u || !slot) return;
      openMechSlot({
        data: d, loadout: u.mech, slot, cards: slotPool(d, slot, u.mech[slot.key]), unitName: u.name,
        onPick: (card) => { u.mech = { ...u.mech, [slot.key]: card.id }; render(); },
      });
      return;
    }
    case 'build-clear': {
      const u = view.unit;
      const key = el.dataset.slot as keyof MechLoadout;
      if (!u) return;
      const next = { ...u.mech };
      delete next[key];
      u.mech = next;
      render();
      return;
    }
    case 'build-rename': {
      const u = view.unit;
      if (!u) return;
      const name = await promptDialog({ title: 'Name this unit', value: u.name || buildDefaultName(d, u.mech), placeholder: 'Unit name', confirmLabel: 'Rename' });
      if (name?.trim()) { u.name = name.trim(); render(); }
      return;
    }
    case 'card': if (!openCardSheet(id)) readCard(d, id); return;
    case 'unit-save':
    case 'unit-copy': {
      const u = view.unit;
      if (!u) return;
      if (!(await confirmLegalBuild(d, u.mech, 'Save anyway'))) return;
      const name = u.name.trim() || buildDefaultName(d, u.mech) || 'My unit';
      const editing = act === 'unit-save' && !u.builtIn && u.id ? loadMechPresets().find((p) => p.id === u.id) : undefined;
      const t = now();
      const saved = updateMechPreset({ id: act === 'unit-copy' || u.builtIn ? '' : u.id, name: act === 'unit-copy' ? `${name} (copy)` : name, mech: u.mech, saved: t }, t);
      // Editing a saved unit carries the change to every squad holding it.
      if (editing) carryMechEdit(editing.mech, saved.mech, t, { unit: saved.id });
      view.unit = { id: saved.id, name: saved.name, mech: { ...saved.mech }, builtIn: false };
      render();
      return;
    }
    case 'unit-del': {
      const u = view.unit;
      if (!u?.id) return;
      const ok = await confirmDialog({
        title: u.builtIn ? `Put away ${u.name}?` : `Delete ${u.name}?`,
        body: u.builtIn ? 'The starter unit is hidden; the squads tab can bring the starters back.' : 'Squads that use this mech keep their own copy of it.',
        confirmLabel: u.builtIn ? 'Put away' : 'Delete',
        danger: true,
      });
      if (!ok) return;
      deleteMechPreset(u.id);
      view.unit = null;
      render();
      return;
    }
    case 'unit-to-squad': {
      const u = view.unit;
      if (!u?.id) return;
      const squads = loadSquads();
      const picked = await choiceDialog({
        title: `Add ${u.name} to which squad?`,
        stacked: true,
        choices: [...squads.map((s) => ({ id: s.id, label: s.name })), { id: 'new', label: 'A new squad…' }, { id: 'cancel', label: 'Cancel', cancel: true }],
      });
      if (!picked || picked === 'cancel') return;
      let target: SavedSquad;
      if (picked === 'new') {
        const name = await promptDialog({ title: 'Name the squad', value: '', placeholder: 'Squad name', confirmLabel: 'Create' });
        if (!name?.trim()) return;
        target = updateSquad({ id: `sq${now()}`, name: name.trim(), mechs: [{ name: u.name, loadout: { ...u.mech } }], drones: [], saved: now() }, now());
      } else {
        const sq = squads.find((s) => s.id === picked);
        if (!sq) return;
        target = updateSquad({ ...sq, mechs: [...sq.mechs, { name: u.name, loadout: { ...u.mech } }] }, now());
      }
      view.unit = null;
      view.tab = 'squads';
      view.squad = target.id;
      view.phoneOpen = true;
      remember();
      render();
      return;
    }
    case 'piece-step': {
      const col = loadCollection();
      const n = Math.max(0, Math.min(99, (col.cards[id] ?? 0) + Number(el.dataset.d)));
      if (n) col.cards[id] = n; else delete col.cards[id];
      saveCollection(col);
      render();
      return;
    }
    case 'box-step': {
      const col = loadCollection();
      const key = el.dataset.key!;
      const n = Math.max(0, Math.min(99, (col.boxes[key] ?? 0) + Number(el.dataset.d)));
      if (n) col.boxes[key] = n; else delete col.boxes[key];
      saveCollection(col);
      render();
      return;
    }
    case 'box-fac': view.boxFaction = el.dataset.facPick ?? ''; render(); return;
    default:
  }
}

// A card scan or a layer that is not there: the scan gives way to its name on
// a plain face, a missing layer simply drops out of the mech's picture. Caught
// here, since the page's CSP allows no inline handlers.
function wireImageFallbacks(el: HTMLElement): void {
  el.addEventListener('error', (ev) => {
    const img = ev.target as HTMLElement;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.classList.contains('cl-layer')) { img.remove(); return; }
    if (img.classList.contains('cl-boxcover')) {
      // As the Reference does: the bleed goes and the tile drops its cover look.
      img.closest('.box-card')?.classList.remove('has-cover');
      img.closest('.box-bleed')?.nextElementSibling?.remove();
      img.closest('.box-bleed')?.remove();
      return;
    }
    if (img.classList.contains('cl-cardimg')) {
      const ph = document.createElement('span');
      ph.className = 'cl-cardph';
      ph.textContent = img.dataset.name ?? '';
      img.replaceWith(ph);
    }
  }, true);
}

root.addEventListener('click', (ev) => { void onClick(ev); });
root.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset.act === 'pieces-q') { view.piecesQuery = t.value; render(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && view.unit && !document.querySelector('.dlg-back, .cl-lightbox, #ref-detail:not([hidden])')) { view.unit = null; render(); }
});
wireImageFallbacks(root);
phoneQuery.addEventListener('change', () => render());

// Another tab, the pad on this device or a pull from the account: redraw.
onLibrary(() => render());
onCollection(() => render());
api.onChange(() => render());

(async () => {
  render();
  // Opens with no signal too, like the pad: the page and its data are cached.
  registerOffline();
  bindCollection(api);
  bindLibrary(api);
  void api.refresh();
  try {
    data = await loadData();
    useSheetData(data);
  } catch {
    loadError = 'The card database could not be loaded. Check the connection and reload.';
  }
  render();
})();
