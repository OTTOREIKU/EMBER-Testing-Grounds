// A box sheet's Cards and Sprues tabs drawn as card images (OTTO picked this
// layout from a run of mockups, 2026-11-03/04). Every card or build is a tile,
// its discard face riding behind it; an either/or is one unit holding its
// options; a magnet drone is its body with its heads. Tiles are sorted by
// name, grouped by faction when the box has more than one, then by slot, and
// each slot group is a module sized to its cards so small groups share a line.

import { assetUrl, cardImageUrl, FACTION_LABEL } from './data';

export interface Tile {
  card: string | null;
  name: string;
  n: number | null;
  faction: string;
  slot: string;
  wide?: boolean;
  discard?: string;
  mode?: boolean;
  look?: '' | 'excl' | 'dim';
  or?: Tile[];
  code?: string;
  kit?: { body: Tile; heads: Tile[] };
  extra?: boolean;
}

// Parts no card shows, by their sprue code. Sources: assets/parts/SOURCES.md.
const PART_ART: Record<string, string> = {
  'DTG-30': 'parts/dtg-30-body.webp',
  ADK15: 'parts/adk15-body.webp',
  ADK30: 'parts/adk30-body.webp',
  'GA-3': 'parts/part-070.webp',
  'Optical Camouflage': 'parts/optical-camouflage.webp',
};
const noArt = (t: Tile): boolean => !t.or && !t.kit && (!t.card || (!!t.code && t.code in PART_ART));

const ICONS: Record<string, string> = {
  drone: '<path d="M7 10h10l2 3H5zM6 13l-2 4M18 13l2 4M9 13l-1 4M15 13l1 4M10 10l1-3h2l1 3"/>',
  grenade: '<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M9 7h6M9 11h6M12 15v4M8 20h8"/>',
  part: '<path d="M12 3l7 4v10l-7 4-7-4V7z"/><circle cx="12" cy="12" r="3"/>',
};
const iconFor = (t: Tile): string => {
  const k = t.slot === 'Drones' ? 'drone' : t.slot === 'Projectiles' ? 'grenade' : 'part';
  return `<svg class="bl-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
};

const SLOTS = ['Torso', 'Chassis', 'Left arm', 'Right arm', 'Backpack', 'Pilots', 'Drones', 'Projectiles', 'Tactics', 'Other'];

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// A part with no card ("part only") sorts after the cards in its group, and an
// Extra (on the sprue, no card or build page) after everything else. A swap
// kit is a group of cards and keeps its place; its body stays first inside it.
// (A rank, not a high character in front of the name: localeCompare ignores
// noncharacters, so that put them anywhere.)
const sortRank = (t: Tile): number => (t.extra ? 2 : noArt(t) ? 1 : 0);
const sortName = (t: Tile): string => (t.or ? t.or[0].name : t.kit ? t.kit.body.name : t.name).toLowerCase();

function byFaction(tiles: Tile[], factions: string[]): { label: string; tiles: Tile[] }[] {
  const sorted = [...tiles].sort((a, b) => sortRank(a) - sortRank(b) || sortName(a).localeCompare(sortName(b)));
  if (factions.length < 2) return [{ label: '', tiles: sorted }];
  const order = [...factions, ...new Set(sorted.map((t) => t.faction).filter((f) => !factions.includes(f)))];
  return order
    .map((f) => ({ label: f ? FACTION_LABEL[f] ?? f : 'Shared', tiles: sorted.filter((t) => t.faction === f) }))
    .filter((g) => g.tiles.length);
}

function bySlot(tiles: Tile[]): { label: string; tiles: Tile[] }[] {
  return SLOTS.map((s) => ({ label: s, tiles: tiles.filter((t) => t.slot === s) })).filter((g) => g.tiles.length);
}

const nBadge = (t: Tile): string => (t.n == null ? '<span class="bl-n">?</span>' : t.n > 1 ? `<span class="bl-n">×${t.n}</span>` : '');

const img = (id: string, name: string, cls = 'bl-img'): string =>
  `<img class="${cls}" src="${cardImageUrl(id)}" alt="" loading="lazy" data-blph="${esc(name)}">`;

// A part with no card art: its picture where we have one, else an icon, with
// its code and name under it.
function noArtTile(t: Tile): string {
  const code = esc(t.code ?? t.name.split(' ')[0]);
  const rest = esc(t.code && t.name.startsWith(t.code) ? t.name.slice(t.code.length).trim() : t.name);
  const attr = t.card ? ` data-card="${esc(t.card)}"` : '';
  const art = t.code && PART_ART[t.code];
  return `<a class="bl-tile bl-noart${art ? ' bl-noart-art' : ''}${t.look ? ` bl-${t.look}` : ''}"${attr} title="${esc(t.name)}">
      <span class="bl-art">${
        art ? `<img class="bl-img bl-drawing" src="${assetUrl(art)}" alt="" loading="lazy">` : `<span class="bl-ph bl-ph-icon">${iconFor(t)}</span>`
      }<span class="bl-noart-lbl"><b>${code}</b><span>${rest}</span><em>${t.extra ? 'extra · no card' : 'part only'}</em></span>${
        t.extra ? '<span class="bl-tag bl-extra">Extra</span>' : nBadge(t)
      }</span></a>`;
}

function tile(t: Tile, opts: { badge?: boolean } = {}): string {
  if (noArt(t)) return noArtTile(t);
  const cls = ['bl-tile', t.wide ? 'bl-wide' : '', t.look ? `bl-${t.look}` : '', t.discard ? 'bl-hasdis' : ''].filter(Boolean).join(' ');
  const attr = t.card ? ` data-card="${esc(t.card)}"` : '';
  // The discard face rides behind its Part; the flip button brings it forward
  // (and the card it opens follows the face in front).
  const dis = t.discard ? ` data-card-front="${esc(t.card ?? '')}" data-card-back="${esc(t.discard)}"` : '';
  return `<a class="${cls}"${attr}${dis} title="${esc(t.name)}">
      <span class="bl-art">${t.discard ? img(t.discard, 'discarded face', 'bl-peek') : ''}${
        t.card ? img(t.card, t.name) : `<span class="bl-ph">${esc(t.name)}</span>`
      }${opts.badge === false || t.extra ? '' : nBadge(t)}${t.mode ? '<span class="bl-tag bl-mode">same card</span>' : ''}${
        t.discard ? '<button type="button" class="bl-flip" data-blflip aria-label="Show discarded side" title="Show discarded side">⟲</button>' : ''
      }</span></a>`;
}

// An either/or: its options side by side inside one dashed outline, each with a
// lettered link tag in the pair's colour, and one count for the pick.
let pairNo = 0;
function pickTile(t: Tile): string {
  const or = t.or!;
  const hue = (pairNo++ % 4) + 1;
  return `<div class="bl-pair bl-hue${hue}${or[0].wide ? ' bl-wide' : ''}" title="Pick 1 of ${or.length}">
      ${or
        .map((x, i) => tile(x, { badge: false }).replace('<span class="bl-art">', `<span class="bl-art"><span class="bl-link">⛓ ${'ABCD'[i]}</span>`))
        .join('')}<span class="bl-n">×${t.n ?? '?'}</span></div>`;
}

// A drone is ONE body with magnetic heads that swap, not a choice between
// builds (RDL DTG-30 Hyena: 30M / 30R / 30S; UN ADK15 Porcupine: 15D / 15P).
// On the Sprues tab the body and its heads are one kit, counted as bodies.
const baseCode = (t: Tile): string => /^([A-Z]+-?\d+)/.exec(t.code ?? t.name)?.[1] ?? '';
const fullCode = (t: Tile): string => /^\S+/.exec(t.code ?? t.name)?.[0] ?? '';

// Only these bodies take their heads on a magnet. The ADK60 Raven's weapons
// are glued on, so a Raven is built once as one of them: an either/or on the
// sprues, not a kit. The ADK30 "Tarantula" takes a UN backpack (ADK30C) or the
// turret (ADK30F) on its magnets (UN Core PDF page 40, Raid UN page 34). `bare`
// names a card a body plays as with nothing on it; none needs it so far.
const MAGNET_BODIES: Record<string, { bare?: string }> = {
  'DTG-30': {},
  ADK15: {},
  ADK30: {},
};

function kitify(tiles: Tile[]): Tile[] {
  const fams = new Map<string, Tile[]>();
  for (const t of tiles.filter((x) => x.slot === 'Drones' && !x.or)) {
    const code = baseCode(t);
    const b = Object.keys(MAGNET_BODIES).find((k) => k === code || MAGNET_BODIES[k].bare === fullCode(t));
    if (b) fams.set(b, [...(fams.get(b) ?? []), t]);
  }
  const used = new Set<Tile>();
  const kits: Tile[] = [];
  for (const [base, fam] of fams) {
    const body = fam.find((t) => !t.card && (t.code ?? '') === base);
    const heads = fam.filter((t) => t !== body && t.card);
    if (heads.length < 2 && !body) continue;
    fam.forEach((t) => used.add(t));
    const b: Tile = body ?? {
      card: null,
      code: base,
      name: `${base} drone body`,
      n: Math.max(...heads.map((h) => h.n ?? 1)),
      faction: heads[0].faction,
      slot: 'Drones',
    };
    // A body with no card of its own takes its side from its heads (Raid holds both).
    kits.push({ ...b, card: null, n: b.n, faction: heads[0]?.faction ?? b.faction, kit: { body: b, heads } });
  }
  return [...tiles.filter((t) => !used.has(t)), ...kits];
}

function kitTile(t: Tile): string {
  const { body, heads } = t.kit!;
  const bare = MAGNET_BODIES[baseCode(body)]?.bare;
  const headTile = (h: Tile): string => {
    const html = tile({ ...h, n: null }, { badge: false });
    // The card a body plays as with no head on it (ADK30C) says so.
    return bare && fullCode(h) === bare ? html.replace('<span class="bl-art">', '<span class="bl-art"><span class="bl-bare">no head</span>') : html;
  };
  const lbl = heads.length > 1 ? '⇄ 1 body · swap heads' : '1 body · 1 head';
  const n = kitCopies(t);
  // One kit per body when there are heads enough for every body (OTTO,
  // 2026-11-04: Door Breaker's two Porcupines each take either head), so no
  // count badge; otherwise one kit with the body count on it.
  const one = `<div class="bl-kit">
      <span class="bl-kit-lbl">${lbl}</span>
      <div class="bl-kit-row">${noArtTile({ ...body, n: n > 1 ? 1 : t.n })}<span class="bl-kit-heads">${heads.map(headTile).join('')}</span></div></div>`;
  return one.repeat(n);
}

// How many times a kit is drawn: once per body, when every head comes as
// many times as there are bodies.
function kitCopies(t: Tile): number {
  const bodies = t.n ?? 1;
  return bodies > 1 && t.kit!.heads.every((h) => (h.n ?? 0) >= bodies) ? bodies : 1;
}

const any = (t: Tile): string => (t.kit ? kitTile(t) : t.or ? pickTile(t) : tile(t));

// The flip button swaps which face is in front, without opening anything.
// True when it took the tap.
export function handleTileTap(t: HTMLElement): boolean {
  const flip = t.closest<HTMLElement>('[data-blflip]');
  if (!flip) return false;
  const card = flip.closest<HTMLElement>('.bl-tile')!;
  const back = card.classList.toggle('bl-flipped');
  card.dataset.card = back ? card.dataset.cardBack : card.dataset.cardFront;
  flip.setAttribute('aria-label', back ? 'Show front' : 'Show discarded side');
  flip.title = flip.getAttribute('aria-label')!;
  return true;
}

// Each module's width comes from what it holds, in card widths (`--u`) plus
// pixels (`--x`: a pair's frame, the gaps inside a pair or kit), so the flow
// packs the same in every browser rather than trusting each one's idea of a
// wrapping flex box's natural width. A drone card prints sideways and is drawn
// the same wide size everywhere (two card widths and a gap: OTTO, 2026-11-04,
// "make sure all drone card images are the same size"); in a swap kit the body
// picture takes that same box, so the row lines up.
const GAP = 8;
const units = (t: Tile): number =>
  t.kit ? (1 + t.kit.heads.length) * 2 * kitCopies(t) : t.or ? t.or.length * (t.or[0].wide ? 2 : 1) : t.wide ? 2 : 1;
const extraPx = (t: Tile): number =>
  t.kit
    ? (14 + t.kit.heads.length * 8 + (1 + t.kit.heads.length) * GAP) * kitCopies(t) + (kitCopies(t) - 1) * GAP
    : t.or
      ? (t.or.length - 1) * 8 + 12 + (t.or[0].wide ? t.or.length * GAP : 0)
      : t.wide
        ? GAP
        : 0;

function module(g: { label: string; tiles: Tile[] }): string {
  const u = g.tiles.reduce((n, t) => n + units(t), 0);
  const total = g.tiles.reduce((n, t) => n + (t.extra ? 0 : Math.max(t.n ?? 0, 1)), 0);
  const x = g.tiles.reduce((n, t) => n + extraPx(t), 0);
  return `<section class="bl-mod" style="--u:${u};--k:${g.tiles.length};--x:${x}px">
      <h4 class="bl-mod-lbl"><span>${esc(g.label)}</span> <span class="fc-n">${total}</span></h4>
      <div class="bl-mod-row">${g.tiles.map(any).join('')}</div></section>`;
}

// `kits`: group a magnet body with its heads. The Sprues tab only: it answers
// what you can build, while the Cards tab lists each card the box ships.
export function renderTiles(tiles: Tile[], factions: string[], kits = false): string {
  pairNo = 0;
  return `<div class="bl-root">${byFaction(kits ? kitify(tiles) : tiles, factions)
    .map((f) => `${f.label ? `<h3 class="ref-sub bl-fac">${esc(f.label)}</h3>` : ''}<div class="bl-mods">${bySlot(f.tiles).map(module).join('')}</div>`)
    .join('')}</div>`;
}

// A scan we do not hold leaves its name in a card outline. Error events do not
// bubble, hence the capture; the page's CSP refuses inline onerror.
let watching = false;
export function watchTileImages(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLImageElement) || el.dataset.blph === undefined) return;
      if (!el.dataset.blph) return void el.remove();
      const ph = document.createElement('span');
      ph.className = 'bl-ph';
      ph.textContent = el.dataset.blph;
      el.replaceWith(ph);
    },
    true,
  );
}
