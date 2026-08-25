import './reference.css';
import { actionIconUrl, boxCoverUrl, cardName, HELP_CARDS, helpCardUrl, TOKEN_PRINT, tokenPrintUrl, factionArtUrl, FACTION_LABEL, isListedBox, loadData, mechPartUrl, missionImageUrl, portraitUrl, secondaryImageUrl, statIconIsPlated, statIconUrl, tabImageUrl, traitName, zeroCostReason, type BoxDef, type FactionDef, type GameData, type KeywordDef } from './data';
import { mountCardImage, mountCardImageCopy, preloadCardImages, warmAllImagesWhenIdle } from './images';
import { runFirstVisitPreload } from './preload';
import { watchForUpdates } from './updates';
import { SHAPE_NOTE, STATUSES, TIMINGS, type Card, type StatusDef } from './types';
import { registerOffline } from './offline';
import { costLabel, LENGTH_NAME, lengthOf, TICK_COST, timingOf } from './ticks';
import { diePips, maskGlyphs, tickCapsule } from './glyphs';
import { linkIcon } from './icons';

type Tab = 'keywords' | 'parts' | 'units' | 'pilots' | 'tactics' | 'boxes' | 'factions' | 'missions' | 'rules';

const SLOT_LABEL: Record<string, string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'Left arm',
  rightHand: 'Right arm',
  backpack: 'Backpack',
};

// The detail header used to print the raw category and type, so a reader met
// "mech_part · chasis" - internal spelling and all - on the page most likely to
// be someone's first. Sizes are not in SLOT_LABEL and just need a capital.
const CATEGORY_LABEL: Record<string, string> = {
  mech_part: 'Mech part',
  drone: 'Drone',
  projectile: 'Projectile',
  pilot: 'Pilot',
  tactics_or_upgrade: 'Tactics card',
};

const TYPE_LABEL: Record<string, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

const STAT_FIELDS: [keyof Card, string][] = [
  ['score', 'Points'],
  ['armor', 'Armor'],
  ['structure', 'Structure'],
  ['parray', 'Parry'],
  ['dodge', 'Dodge'],
  ['electronic', 'Electronic'],
  ['move', 'Move'],
];

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

const body = () => document.getElementById('ref-body')!;
// The boxed glyph printed beside a Drone action's name says when it happens.
const SPEED_MARK: Record<string, { glyph: string; title: string; label: string }> = {
  auto: { glyph: '!', title: 'Automatic Action', label: 'Automatic Action' },
  command: { glyph: '?', title: 'Command Action', label: 'Command Action' },
  passive: { glyph: '∞', title: 'Passive', label: 'Passive' },
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const norm = (s: string) => s.toLowerCase();

// Several `en` fields in the card data still hold the Chinese text, so an `en`
// value is not proof of English. Anything that would print card text has to
// test the text itself, not just which field it came from.
const CJK = /[぀-ヿ一-鿿]/;
const englishOnly = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t && !CJK.test(t) ? t : undefined;
};

// The English an Action actually shows, from wherever it comes: the card's own
// field when that really is English, and the publisher text filed in
// action_translations when it is not. Written once here because three separate
// readers were deriving it, and a fourth would have drifted.
function actionEnglish(a: { id: string; description?: { en?: string } }): string {
  return englishOnly(a.description?.en) ?? data.actionTranslation(a.id)?.english ?? '';
}

// ---------- WHICH PART PUTS THIS THING ON THE BOARD ----------
//
// The inverse of the card links below: a reader looking at SGM-2 Pholcus
// Automatic Mine wants to know what deploys it, and the mine's own card says
// nothing about the rack. The relationship only exists in the PART's action
// text ("Launch 1 SGM2 Pholcus Automatic Mine"), so it is read back out of
// there rather than stored, which means it cannot go stale against the text.
//
// Built once and cached: without that this is a full scan of every action on
// every card for each detail opened.
let deployIndex: Map<string, Card[]> | null = null;

function bareName(s: string): string {
  return stripQuotes(s).text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function deployedBy(c: Card): Card[] {
  if (!deployIndex) {
    deployIndex = new Map();
    const targets: { id: string; bare: string }[] = [];
    for (const t of data.cards) {
      if (t.category !== 'projectile' && t.category !== 'drone') continue;
      const bare = bareName(t.name?.en ?? '');
      // Same floor as the linker, and for the same reason: a short name matches
      // ordinary prose. CJK is out because an `en` field is not proof of English.
      if (bare.length < 8 || CJK.test(bare)) continue;
      targets.push({ id: t.id, bare });
    }
    for (const p of data.cards) {
      for (const a of p.actions ?? []) {
        const hay = bareName(actionEnglish(a));
        if (!hay) continue;
        for (const t of targets) {
          // A card naming itself is not a source: the Pholcus (Unfolded) face
          // prints its own name, and listing it under "comes from" would send
          // the reader in a circle.
          if (t.id === p.id || !hay.includes(t.bare)) continue;
          const list = deployIndex.get(t.id) ?? [];
          if (!list.some((x) => x.id === p.id)) list.push(p);
          deployIndex.set(t.id, list);
        }
      }
    }
  }
  return deployIndex.get(c.id) ?? [];
}

let linkPatterns: { name: string; re: RegExp; len: number; card?: boolean }[] | null = null;

// THE QUOTES DO NOT AGREE, in three different ways at once:
//   card 071  `MC-3 "Razor" Missile`      text: straight quotes    -> same
//   ZHAM-002  `M60 “Boomerang” Missile`   text: straight quotes    -> differ
//   card 159  `AMDS210 Delphinium ...`    text: "Delphinium"       -> card has NONE
// Matching quote VARIANTS handles the second and not the third, which is how
// Delphinium stayed unlinked after the first attempt at this. So quotes are
// removed from BOTH sides instead of reconciled, and the match runs on the
// stripped text.
//
// `map` carries each stripped character back to where it came from, because the
// span that gets wrapped in the anchor has to be the ORIGINAL one, quotes and
// all: rebuilding the text from the stripped copy would silently delete every
// quotation mark on the page.
const QUOTE = /["“”'‘’]/;
function stripQuotes(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (QUOTE.test(s[i])) continue;
    text += s[i];
    map.push(i);
  }
  return { text, map };
}

function linkKeywords(text: string): string {
  // Glyph placeholders are masked out before the keyword pass, because several
  // of them ({Heavy Hit}, {Dodge}) are keyword names in their own right.
  const { masked: src, restore } = maskGlyphs(esc(text));
  if (!linkPatterns) {
    const seen = new Set<string>();
    linkPatterns = [];
    for (const k of data.keywords) {
      const n = k.en?.name?.replace(/^[•·\s]+/, '') ?? '';
      if (n.length < 3 || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      const body = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\bX\b/g, '\\d+');
      try {
        linkPatterns.push({ name: n, re: new RegExp(`\\b${body}\\b`, 'gi'), len: n.length });
      } catch {
      }
    }
    // THE THING ITSELF, not the word for it. "Launch 1 MC-3 "Razor" Missile"
    // used to link `Missile`, the keyword, when the reader almost certainly
    // wants the projectile the sentence names and which we hold a card for.
    // Projectiles and drones only: those are what an Action launches, deploys
    // or fires by name, and both are cards a reader can open.
    //
    // Sorting longest-first below is what makes this win: `MC-3 "Razor"
    // Missile` is 20 characters against `Missile`'s 7, so the card claims the
    // span and the keyword cannot overlap it. Where the text says only
    // "Missile", the keyword still links, which is the right answer there.
    for (const c of data.cards) {
      if (c.category !== 'projectile' && c.category !== 'drone') continue;
      const n = stripQuotes((c.name?.en ?? '').trim()).text.replace(/\s+/g, ' ').trim();
      // Short names are the ones that collide with ordinary words; every real
      // projectile and drone name is ten characters or more.
      //
      // CJK is rejected for the usual reason: an `en` field is not proof of
      // English here. name_overrides fixes 154 and 155 at load, so this is
      // belt and braces rather than a live case, but a Chinese name could only
      // ever match Chinese text and the length floor does not catch one - a
      // four-character Chinese name is a long phrase.
      if (n.length < 8 || CJK.test(n) || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      const body = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        linkPatterns.push({ name: c.id, re: new RegExp(body, 'gi'), len: n.length, card: true });
      } catch {
      }
    }
    // Sorted on the matched NAME length, never the pattern source: quoteLoose
    // inflates a card pattern by four characters per quote, so source length
    // would rank by punctuation rather than by how much text is claimed.
    linkPatterns.sort((a, b) => b.len - a.len);
  }

  const hits: { start: number; end: number; label: string; card?: boolean }[] = [];
  // The quote-stripped copy, built once. Cards match against it; keywords match
  // the original, because a keyword name never contains a quote.
  const bare = stripQuotes(src);
  for (const { name, re, card } of linkPatterns) {
    const hay = card ? bare.text : src;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      // A card hit is in stripped coordinates and has to come back to real
      // ones before anything slices the source with it. `end` maps off the LAST
      // character rather than the one past it, which would run off the array on
      // a match that ends the string.
      const start = card ? bare.map[m.index] : m.index;
      const last = card ? bare.map[m.index + m[0].length - 1] : m.index + m[0].length - 1;
      if (start === undefined || last === undefined) continue;
      const end = last + 1;
      if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, label: name, card });
    }
  }
  if (!hits.length) return restore(src);

  hits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const h of hits) {
    out += src.slice(at, h.start);
    // A card hit opens the card, a keyword hit opens the glossary. Both are
    // already answered by the document-level delegation, so neither needs a
    // handler of its own.
    out += h.card
      ? `<a class="kw-link" data-card="${esc(h.label)}">${src.slice(h.start, h.end)}</a>`
      : `<a class="kw-link" data-kw="${esc(h.label)}">${src.slice(h.start, h.end)}</a>`;
    at = h.end;
  }
  return restore(out + src.slice(at));
}

// Keywords link because they are glossary entries; rules like Crush and Low
// Value are mechanics rather than keywords, so they get spelled out beneath the
// text that names them. Anything not mentioned matches nothing and prints
// nothing, so this stays quiet wherever it is not wanted.
// THE RULEBOOK DEFINITIONS, FOLDED AWAY. Printing every glossary entry in full
// under every card that mentions it buried the card's own text: a Main Task is
// three lines of its own rules followed by a paragraph of Black Box, and the
// paragraph is the same paragraph on all three Black Box missions.
//
// `details`/`summary` rather than a button and a class: it opens with the
// keyboard, it is announced as expandable without any ARIA of ours, and
// crucially it needs NO click handler, so it cannot collide with the
// document-level delegation that turns [data-kw] and [data-mission] into
// navigation. Closed by default; the summary still names the rule and its
// rulebook reference, so what is hidden is only the wording.
// Names already drawn somewhere in this detail. A rulebook definition is worth
// repeating under each ACTION that needs it, because a reader looking at one
// action should not have to hunt; it is not worth repeating at CARD level under
// a definition an action already carries, which is how "Pulse Weapon" came to
// appear twice in one popup.
let mechSeen: Set<string> | null = null;

function mechBlocks(...text: (string | undefined)[]): string {
  return data
    .mechanicsFor(...text)
    .filter((m) => {
      if (!mechSeen) return true;
      if (mechSeen.has(m.name)) return false;
      mechSeen.add(m.name);
      return true;
    })
    .map(
      (m) => `<details class="ref-mech">`
        + `<summary><b>${esc(m.name)}</b>${m.ref ? ` <em>(${esc(m.ref)})</em>` : ''}</summary>`
        // linkKeywords runs on the BODY only. In the summary its [data-kw]
        // anchors would sit inside the toggle, so one tap would both open the
        // panel and navigate away from it.
        + `<div class="ref-mech-b">${linkKeywords(m.text)}</div>`
        + `</details>`,
    )
    .join('');
}

function keywordCard(k: KeywordDef): string {
  const name = k.en?.name?.replace(/^[•·\s]+/, '') || k.key;
  const val = k.en?.value || '';
  const isTag = /tag on the card banner/.test(val);
  return `<article class="card card-tap" data-kwitem="${esc(name)}">
    <div class="card-title">${esc(name)}</div>
    <div class="card-body">${val ? linkKeywords(val) : '<em>No English glossary text for this keyword.</em>'}</div>
    <div class="card-foot">
      ${isTag ? '<span class="tag">type tag</span>' : '<span class="tag">keyword</span>'}
    </div>
  </article>`;
}

function kwLabel(k: { key?: string; en?: string; inline?: string }): string {
  const def = data.keyword(k.key || k.inline || k.en || '');
  const label = def?.en?.name?.replace(/^[•·\s]+/, '');
  const raw = (k.en || k.inline || k.key || '').replace(/^[•·\s]+/, '');
  if (!label) return raw;
  const num = /(\d+)\s*$/.exec(raw)?.[1];
  if (!num) return label;
  if (/\bX\b/.test(label)) return label.replace(/\bX\b/, num);
  return /\d/.test(label) ? label : `${label} ${num}`;
}

function pointsChip(c: Card): string {
  if (c.score) return `<span class="mono card-pts">${c.score}p</span>`;
  const why = zeroCostReason(c);
  return why ? `<span class="card-pts card-free" title="${esc(why)}">free</span>` : '';
}

function cardRow(c: Card): string {
  const slot = c.type && SLOT_LABEL[c.type] ? SLOT_LABEL[c.type] : c.type || '';
  const stats: string[] = [];
  if (typeof c.armor === 'number' && c.armor) stats.push(`A${c.armor}`);
  if (typeof c.structure === 'number' && c.structure) stats.push(`S${c.structure}`);
  if (typeof c.parray === 'number' && c.parray) stats.push(`P${c.parray}`);
  if (typeof c.dodge === 'number' && c.dodge) stats.push(`D${c.dodge}`);
  if (typeof c.electronic === 'number' && c.electronic) stats.push(`E${c.electronic}`);
  if (typeof c.move === 'number' && c.move) stats.push(`M${c.move}`);
  const acts = (c.actions ?? []).map((a) => a.name.en || a.name.zh || '').filter(Boolean).slice(0, 3);
  const actIcons = [...new Set((c.actions ?? []).map((a) => a.type).filter(Boolean))]
    .map((t) => ({ t, url: actionIconUrl(t) }))
    .filter((x) => x.url)
    .map((x) => `<img class="act-icon" src="${x.url}" alt="" title="${esc(String(x.t))}">`)
    .join('');
  // Drones carry a speed glyph per action, so the summary shows which speeds a
  // card has without needing the card open.
  const speedMarks = [...new Set((c.actions ?? []).map((a) => a.speed).filter((sp) => !!sp && sp !== 'passive'))]
    .map((sp) => `<span class="act-speed sp-${esc(sp!)}" title="${esc(SPEED_MARK[sp!]?.title ?? '')}">${SPEED_MARK[sp!]?.glyph ?? ''}</span>`)
    .join('');
  const kws = [...new Set((c.keywords ?? []).map(kwLabel).filter(Boolean))].slice(0, 3);
  const isPilot = c.category === 'pilot';
  const isTactic = c.category === 'tactics_or_upgrade';
  const tacticText = isTactic
    ? ((c.actions ?? []).map((a) => a.description?.en || a.description?.zh || '').find(Boolean) ?? '')
    : '';
  // The tile NAMES the trait now that there is an English name to print. It
  // used to say "has a trait ability" and no more, because the only name in the
  // data was Chinese and a grid of English tiles is the wrong place for it —
  // and a pilot is picked FOR its trait, so scanning the grid without one meant
  // opening every card.
  const body = isPilot
    ? `${c.faction ?? ''}${c.trait ? ` · ${traitName(c)}` : ''}`
    : isTactic
      ? tacticText
      : acts.join(' · ');
  const fac = data.factionOf(c);
  return `<article class="card card-tap card-framed${isPilot ? ' card-pilot' : ''}"${
    fac ? ` data-fac="${esc(fac)}"` : ''
  } data-card="${esc(c.id)}">
    ${pointsChip(c)}
    ${isPilot ? `<div class="pilot-thumb" data-portrait="${esc(c.id)}"></div>` : ''}
    ${isPilot ? '' : `<div class="ref-art" data-partart="${esc(c.id)}" aria-hidden="true"></div>`}
    <div class="card-main">
      <div class="card-title">${esc(cardName(c))}</div>
      ${body ? `<div class="card-body">${esc(body)}</div>` : ''}
      <div class="card-foot">
        ${slot ? `<span class="tag">${esc(slot)}</span>` : ''}
        ${actIcons || speedMarks ? `<span class="act-icons">${actIcons}${speedMarks}</span>` : ''}
        ${isPilot && typeof c.LV === 'number' ? `<span class="tag mono">Link ${c.LV}</span>` : ''}
        ${stats.length ? `<span class="mono card-stats">${esc(stats.join(' '))}</span>` : ''}
      </div>
      ${kws.length ? `<div class="card-badges">${kws.map((k) => `<span class="tag tag-kw">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>
  </article>`;
}

// The publisher's own card page, which is what the QR code on the card opens.
// It is keyed by the QR number: our numeric ids are that number already, and
// serial-style ids get theirs from data/qr_ids.json where one has been verified.
// Some ids are not filled in upstream yet and show a placeholder there, so the
// wording promises the publisher's page rather than a guarantee of content.
function officialLink(c: Card): string {
  if (!c.qrId) return '';
  const url = `https://obsidianprotocol.net/#/info?id=${c.qrId}&lang=en`;
  return `<p class="ref-official"><a href="${url}" target="_blank" rel="noopener noreferrer">Official card page ↗</a></p>`;
}

function cardDetail(c: Card): string {
  // Link is the one stat the printed card colours, tinting its mark to the
  // pilot's faction, so it is drawn through the mask rather than as one more
  // white tile.
  // THE STAT CELL. The mark is MASKED rather than plated: every stat icon is
  // monochrome artwork on transparency, and half of them are near white
  // (Dodge, Parry and Electronic measure 1.16:1 to 1.32:1 against the white
  // plate this used to draw, which is why they were all but invisible). Masked,
  // the icon takes the surrounding text colour and works on any surface at any
  // size. Only the ACTION icons keep their artwork, because their colour is the
  // timing and masking would throw that away; those are plated below, on a
  // light plate, exactly as the printed card plates them.
  // THE STAT CELL, following what the card prints.
  //
  // Armor, Dodge, Parry and Electronic each ship as artwork with the printed
  // BOX baked in, so they are drawn as images and need no plate of ours: what
  // you see is the mark off the card. Masking them was a mistake and drew four
  // blank squares, because their alpha is the box rather than the glyph.
  //
  // STRUCTURE HAS NO GLYPH ON THE CARD. The print gives it a plain dark box
  // holding the number, next to Armor's, and our data was borrowing Armor's
  // icon for it, so the two sat side by side looking identical. It gets the
  // printed treatment instead.
  //
  // The Link mark stays masked on purpose: it is a true silhouette and it takes
  // the pilot's faction colour the way the printed card does.
  const chip = (field: string, value: unknown, label: string) => {
    const zero = Number(value) === 0 ? ' zero' : '';
    if (field === 'structure') {
      return `<div class="ds"><span class="dsv"><b class="boxed${zero}">${value}</b><i>${esc(label)}</i></span></div>`;
    }
    const ic = field === 'LV' ? '' : statIconUrl(field);
    const mark =
      field === 'LV'
        ? linkIcon(data.factionOf(c), 'lk-stat')
        : ic
          ? statIconIsPlated(field)
            ? `<img class="stat-plate" src="${ic}" alt="">`
            : `<span class="stat-mark" style="--src:url(${ic})"></span>`
          : '';
    return `<div class="ds">${mark}<span class="dsv"><b class="${zero.trim()}">${value}</b><i>${esc(label)}</i></span></div>`;
  };
  const stats = STAT_FIELDS.filter(([f]) => typeof c[f] === 'number')
    .map(([f, label]) => chip(f as string, c[f], label))
    .join('');
  const pilotStats =
    c.category === 'pilot'
      ? (['LV', 'swift', 'melee', 'projectile', 'firing', 'moving', 'tactic'] as const)
          .filter((f) => typeof c[f] === 'number')
          .map((f) => chip(f, c[f], f === 'LV' ? 'Link' : f))
          .join('')
      : '';
  const kws = [...new Set((c.keywords ?? []).map(kwLabel).filter(Boolean))]
    .map((label) => `<a class="kw-link" data-kw="${esc(label)}">${esc(label)}</a>`)
    .join('');
  // Dedupe from HERE, so the actions each keep the definitions they need and
  // only the CARD level block below drops what they already showed. Reset per
  // card detail rather than left standing, or the second card opened would
  // silently lose every definition the first one used.
  mechSeen = new Set<string>();
  const actions = (c.actions ?? [])
    .map((a) => {
      const len = lengthOf(a);
      const cost = len ? `${LENGTH_NAME[len]} (${costLabel(TICK_COST[len])})` : '';
      const en = englishOnly(a.description?.en);
      const tr = data.actionTranslation(a.id);
      let text = '';
      if (en) text = linkKeywords(en);
      else if (tr?.english) {
        // THE NOTE KEYS ON PROVENANCE, which the data has recorded all along
        // and this ignored. `action_translations.json` marks every entry with a
        // `confidence`, and 55 of the 61 actions that were printing "translated
        // from the Chinese card text" are marked `printed`: they were read off
        // the English card, so the note was not merely noise, it was false. The
        // file is named for the machine-translated entries it started as, and
        // the printed ones were filed into it later as corrections.
        //
        //   printed            the English card says this. No note.
        //   printed-truncated  the English card says this but overflows its box,
        //                      so the tail is completed from the Chinese. Worth
        //                      a note, but not THAT note.
        //   anything else      genuinely our translation. 6 actions.
        const conf = String(tr.confidence ?? '');
        // The entry's own note explains the individual case; it is too long for
        // the line but exactly right as a tooltip.
        const why = tr.note ? ` title="${esc(tr.note)}"` : '';
        const flag =
          conf === 'printed'
            ? ''
            : conf.startsWith('printed')
              ? `<em class="ref-note"${why}> (the printed English runs off the card; the end is completed from the Chinese)</em>`
              : `<em class="ref-note"${why}> (translated from the Chinese card text)</em>`;
        text = `${linkKeywords(tr.english)}${flag}`;
      }
      else text = '<em class="ref-note">No rules text on this card.</em>';
      // The Chinese DESCRIPTION has to be fed in as well as the Chinese name.
      // Several mechanics can only be matched on it - Loads is `负载`, Mines is
      // `地雷`, the Pholcus is `自行地雷` - because the English prints those as
      // ordinary words that fire inside "payload" and "determined". Passing only
      // the name meant those three entries were written, shipped, and never once
      // displayed on the card that needed them.
      const mechHtml = mechBlocks(a.name.en, a.name.zh, en, a.description?.zh, tr?.english ?? undefined);
      const icon = actionIconUrl(a.type);
      // THE PRINTED TICK CAPSULE. It counts TOTAL Ticks the way the card draws
      // them: Short 1, Medium 2, Long 3. The card's three slots are identical,
      // so the Maneuver Tick a Long action also costs is named in the title
      // rather than shown in a second colour, which would be our invention
      // painted onto a mark players already know from the table.
      const ticks = len ? TICK_COST[len].maneuver + TICK_COST[len].action : 0;
      // THE ROW, laid out the way the card prints it: the type icon on a light
      // plate, then the tick capsule, then the name on a bar in the TIMING
      // colour, then the rules text underneath. Timings the dial can be set to
      // get their tint; a Passive, Immediate, Delay or Detonation is not a
      // timing at all and takes the neutral bar the cards give it.
      // A Command or Automatic action is NOT taken on the Timing Dial, and the
      // printed card says so by giving it a BLACK bar instead of a timing
      // colour (ZHDR-201's |TEAR| and |MISSILE| are both black). Following that
      // also removes a collision our own tints created: the Command mark's blue
      // sat on the blue Movement bar and vanished into it.
      const dialless = a.speed === 'auto' || a.speed === 'command';
      const timing = dialless ? undefined : timingOf(a);
      // The meta line drops the length, which the capsule beside the name now
      // says better than the words did. What is left is the numbers, and the
      // Range is SPELLED OUT: "R 6" reads as a die code beside "3R", and the
      // two mean entirely different things.
      const numbers = [
        a.range === 0 ? esc('Range --') : a.range ? esc(`Range ${a.range}`) : '',
        // YELLOW BEFORE RED, which is the order the cards print. CC-100
        // Hercules Meteor Hammer lays its pool out as two yellow then five red;
        // we had it the other way round on every action.
        diePips(a.yellowDice, 'Y'),
        diePips(a.redDice, 'R'),
        a.storage ? esc(`Ammo ${a.storage}`) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<div class="ref-action${timing ? ` t-${timing}` : dialless ? ' t-dialless' : ''}">
        <div class="ra-h">
          ${icon ? `<span class="ra-type"><img src="${icon}" alt="" title="${esc(a.type ?? '')}"></span>` : ''}
          ${tickCapsule(ticks, cost)}
          <span class="ra-name">${
            SPEED_MARK[a.speed ?? ''] ? `<span class="act-speed sp-${esc(a.speed!)}" title="${esc(SPEED_MARK[a.speed!].title)}">${SPEED_MARK[a.speed!].glyph}</span>` : ''
          }<span class="ra-t">${esc(a.name.en || a.name.zh || a.id)}</span>${
            a.type ? `<em>${esc(a.type)}</em>` : ''
          }</span>
        </div>
        <div class="ra-b">
          ${a.speed && SPEED_MARK[a.speed]
            ? `<p class="ref-speed"><a class="kw-link" data-kw="${esc(SPEED_MARK[a.speed].label)}">${esc(SPEED_MARK[a.speed].label)}</a></p>`
            : ''}
          ${numbers ? `<p class="ref-meta">${numbers}</p>` : ''}
          <p>${text.replace(/\n/g, '<br>')}</p>
          ${mechHtml}
        </div>
      </div>`;
    })
    .join('');
  // TWO names, and the split is the point. `traitZh` is the card's own Chinese
  // and is what decides whether there IS a trait and what the mechanics matcher
  // is fed; `traitShown` is what a reader sees. Merging them would either print
  // 功率隐匿 in an English detail view or hand "Stealth" to a matcher whose
  // patterns are Chinese — see Card.traitNameEn.
  const traitZh = c.trait?.trim();
  const traitShown = traitZh ? esc(traitName(c)) : '';
  const traitText = c.traitDescription?.en || c.traitDescription?.zh || '';
  // A trait may name a rule rather than a keyword. Onyx says its Mech "may Crush
  // large units", and Crush is a mechanic, so the keyword pass alone left the
  // one word a reader needs unexplained. Actions already spell these out.
  const traitMechs = mechBlocks(traitText, c.traitDescription?.zh, traitZh);
  const trait =
    traitZh || traitText
      ? `<div class="ref-trait${traitZh ? '' : ' ref-flavour'}"><b>${
          traitZh ? `Pilot Trait <i>${traitShown}</i>` : 'No trait ability'
        }</b><p>${linkKeywords(traitText).replace(/\n/g, '<br>')}</p>${
          traitZh ? traitMechs : '<p class="ref-note">This pilot has no trait ability. The line above is card flavour text.</p>'
        }</div>`
      : '';
  const inBoxes = (c.containedIn ?? [])
    .map((e) => ({ def: data.boxes.find((x) => x.key === e.box), n: e.quantityPerBox }))
    .filter((x) => x.def);
  const unsold = inBoxes.length > 0 && inBoxes.every((x) => x.def!.key === 'UNSALE');
  // 49 cards have no box at all, and saying nothing read as an oversight rather
  // than a known gap. Each kind is blank for its own reason, so each says so.
  const noBoxNote =
    c.category === 'projectile'
      ? 'No box of its own. A Projectile is not bought separately: it comes with the Part that launches it.'
      : c.category === 'tactics_or_upgrade'
        ? 'No box recorded in the card data. The rulebook has the six Tactics Cards coming in the core box.'
        : 'No box recorded. Nothing in the data says which set ships this card, which is not the same as it having none.';
  // "In: " only makes sense in front of an actual list of boxes; the two
  // fallbacks are whole sentences.
  const listsBoxes = inBoxes.length > 0 && !unsold;
  const boxes = !inBoxes.length
    ? noBoxNote
    : unsold
    ? 'Not sold in any box yet. It is in the card database, but no set ships it.'
    : inBoxes
        .filter((x) => x.def!.key !== 'UNSALE')
        .map(
          (x) =>
            `<a class="kw-link" data-box="${esc(x.def!.key)}">${esc(x.def!.name.en || x.def!.name.zh || x.def!.key)}</a>${
              x.n > 1 ? ` <span class="mono">×${x.n}</span>` : ''
            }`,
        )
        .join(', ');

  // Some cards print rules on the card itself rather than on an Action. A
  // "White Dwarf" Bit reads "· Low Value · High Altitude", and that line is the
  // whole reason it cannot take a Task Item, so dropping it loses real rules.
  // The Chinese original is never shown: on the 16 cards that only have it, it
  // is a keyword reminder line whose English is already a chip above. The
  // mechanics blocks still read the zh, so a card whose only rules line is
  // Chinese keeps its explanation — TM39D's Overwatch Fire token is nothing but
  // that line, so gating the block on English would hide the one thing a reader
  // who cannot read the card most needs.
  const cardText = englishOnly(c.description?.en) ?? '';
  const cardMechs = mechBlocks(c.description?.en, c.description?.zh);
  // Closed again the moment this card is built. It is module state so that one
  // detail's actions can inform its own card block, and leaving it open would
  // carry that answer into every list and mission rendered afterwards.
  mechSeen = null;
  // Pilots are left out: their card line is flavour, and the trait block below
  // already labels it as such.
  const cardBlock = (cardText || cardMechs) && c.category !== 'pilot'
    ? `<div class="ref-cardtext">${
        cardText ? `<p>${linkKeywords(cardText).replace(/\n/g, '<br>')}</p>` : ''
      }${cardMechs}</div>`
    : '';

  const free = zeroCostReason(c);
  // Only pilots carry a faction on the card; every other faction is derived from
  // box membership. The list rows are already tinted by it, so the detail naming
  // only the pilots' was the odd one out.
  const detailFac = data.factionOf(c);
  // THE THUMBNAIL RIDES THE TITLE. It sat above the stat strip, which cost the
  // strip a third of its width and squeezed the longer labels (PROJECTILE,
  // ELECTRONIC) into their neighbours. Up here it costs the strip nothing, and
  // it is the first thing on the panel either way.
  //
  // NOT FOR PILOTS: their portrait is already a headshot of the same person in
  // the same place, so a card thumbnail beside it is the same picture twice.
  const wantsThumb = c.category !== 'pilot';
  return `<div class="dhead">
    ${wantsThumb ? `<button class="dthumb" data-dtab="photo" title="See the printed card"><span class="ref-cardimg-slot" data-img="${esc(c.id)}"></span></button>` : ''}
    <div class="dhead-t">
      <h2>${esc(cardName(c))}</h2>
      <p class="ref-meta">${esc(
        [
          CATEGORY_LABEL[c.category] ?? c.category,
          c.type ? SLOT_LABEL[c.type] ?? TYPE_LABEL[c.type] ?? c.type : '',
          detailFac ? FACTION_LABEL[detailFac] ?? detailFac : '',
        ]
          .filter(Boolean)
          .join(' · '),
      )}</p>
      ${officialLink(c)}
    </div>
  </div>
    <div class="dtabs" role="tablist">
      <button data-dtab="card" class="on" role="tab" aria-selected="true">Card</button>
      <button data-dtab="photo" role="tab" aria-selected="false">Photo</button>
      <button data-dtab="boxes" role="tab" aria-selected="false">Boxes</button>
    </div>
    <div class="dpanel" data-dpanel="card">
      ${c.category === 'pilot' ? `<div class="ref-portrait" data-portrait="${esc(c.id)}"></div>` : ''}
      ${free ? `<p class="ref-free">Costs 0 points: ${esc(free)}.</p>` : ''}
      ${stats || pilotStats ? `<div class="ref-stats">${stats}${pilotStats}</div>` : ''}
      ${trait}
      ${actions ? `<h3 class="ref-sub">Actions</h3>${actions}` : ''}
      ${
        // THE CARD'S OWN KEYWORDS AND RULES, at the FOOT of the panel.
        //
        // They used to sit between the stats and the actions, which put a
        // paragraph of rulebook definition in front of the thing a reader
        // opened the card to read. Worse, the card banner repeats keywords the
        // actions print for themselves, so the top of every weapon led with a
        // list the actions were about to give again in context.
        //
        // Below the actions they read as what they are: the card-level notes,
        // for anyone who wants them after the actions have been read.
        (() => {
          // WHAT PUTS THIS ON THE BOARD. A projectile or drone card says
          // nothing about the Part that deploys it: the relationship is printed
          // on the PART, so without this a reader who opened the mine from a
          // search has no way back to the rack that lays it.
          const from = deployedBy(c);
          const fromHtml = from.length
            ? `<h3 class="ref-sub">Comes from</h3><div class="ref-kwlinks">${from
                .map((p) => `<a class="kw-link" data-card="${esc(p.id)}">${esc(cardName(p))}</a>`)
                .join('')}</div>`
            : '';
          return kws || cardBlock || fromHtml
            ? `<div class="dfoot">
                ${kws ? `<h3 class="ref-sub">Keywords on this card</h3><div class="ref-kwlinks">${kws}</div>` : ''}
                ${cardBlock}
                ${fromHtml}
              </div>`
            : '';
        })()
      }
    </div>
    <div class="dpanel" data-dpanel="photo" hidden>
      <figure class="ref-scan">
        <div class="ref-cardimg-slot" data-img="${esc(c.id)}"></div>
      </figure>
    </div>
    <div class="dpanel" data-dpanel="boxes" hidden>
      ${boxes ? `<p class="ref-boxes">${listsBoxes ? 'In: ' : ''}${boxes}</p>` : ''}
      ${
        // The same box cards the Boxes tab lists, art and all. The panel had a
        // sentence in it and nothing else, and the sentence names boxes a
        // reader then has to go and find; these open straight to them.
        listsBoxes
          ? `<div class="dboxcards">${inBoxes
              .filter((x) => x.def!.key !== 'UNSALE')
              .map((x) => boxRow(x.def!))
              .join('')}</div>`
          : ''
      }
    </div>`;
}

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
  const items = boxContents(key);
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
      <ul class="box-parts">${g.hit
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
    ${box.hasImage ? `<div class="box-cover"><img src="${boxCoverUrl(box.id)}" alt="" loading="lazy" onerror="this.closest('.box-cover').remove()"></div>` : ''}
    ${list || '<p class="ref-note">No cards in the data list this box.</p>'}`;
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
  const count = (label: string, n: number) => (n ? `<span class="tag mono">${n} ${label}${n === 1 ? '' : 's'}</span>` : '');
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
        ? `<div class="box-bleed" aria-hidden="true"><img src="${boxCoverUrl(b.id)}" alt="" loading="lazy" onerror="this.closest('.box-card').classList.remove('has-cover'); this.closest('.box-bleed').remove()"></div>
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

// ---------- one predicate per pool, shared by the tab lists AND the badges ----------
//
// The counts painted onto the tab strip and the rows a tab then shows have to
// come from the SAME test, or a badge promises matches the tab fails to
// produce. So every filter that used to live inline in render() lives here
// once, and both callers read it.
const matchKeyword = (k: KeywordDef, q: string): boolean =>
  !q || norm(`${k.en?.name ?? ''} ${k.en?.value ?? ''} ${k.key} ${k.zh?.name ?? ''}`).includes(q);
const matchMission = (m: (typeof data.missions.cards)[number], q: string): boolean =>
  !q || norm(`${m.name} ${m.nameKo ?? ''} ${m.setup} ${m.scoring} ${(m.zones ?? []).join(' ')}`).includes(q);
const matchFamily = (f: (typeof data.missions.families)[number], q: string): boolean =>
  !q || norm(`${f.name} ${f.text} ${(f.faq ?? []).map((x) => x.q + x.a).join(' ')}`).includes(q);
const matchSecondary = (s: (typeof data.secondary)[number], q: string): boolean =>
  !q || norm(`${s.name} ${s.nameKo ?? ''} ${s.setup} ${s.scoring} ${s.token ?? ''}`).includes(q);
const matchFaction = (f: (typeof data.factions)[number], q: string): boolean =>
  !f.hidden && (!q || norm(`${f.name} ${f.short} ${f.key} ${f.supplier ?? ''} ${f.hook ?? ''} ${f.text}`).includes(q));
const matchBox = (b: (typeof data.boxes)[number], q: string): boolean => {
  if (!q) return true;
  const contents = boxContents(b.key).map((i) => cardName(i.card)).join(' ');
  return norm(`${b.name.en ?? ''} ${b.name.zh ?? ''} ${b.key} ${contents}`).includes(q);
};
const matchCard = (c: Card, q: string): boolean => {
  if (!q) return true;
  const kw = (c.keywords ?? []).map((k) => k.en || k.inline || k.key).join(' ');
  const acts = (c.actions ?? []).map((a) => `${a.name.en ?? ''} ${a.description?.en ?? ''}`).join(' ');
  return norm(`${cardName(c)} ${c.id} ${c.type ?? ''} ${kw} ${acts}`).includes(q);
};
const matchMechanic = (m: (typeof data.mechanics)[number], q: string): boolean =>
  !q || norm(`${m.name} ${m.text} ${m.ref ?? ''}`).includes(q);
const matchPhase = (x: (typeof data.play.phases)[number], q: string): boolean =>
  !q || norm(`${x.name} ${x.who ?? ''} ${x.can.join(' ')} ${x.cannot.join(' ')}`).includes(q);
const matchTiming = (x: (typeof data.play.timings)[number], q: string): boolean =>
  !q || norm(`${x.name} timing ${x.text}`).includes(q);
const matchStance = (x: (typeof data.play.stances)[number], q: string): boolean =>
  !q || norm(`${x.name} ${x.short} stance ${x.effect} ${x.good} ${x.cost}`).includes(q);
const matchStatus = (d: (typeof STATUSES)[number], q: string): boolean =>
  !q || norm(`${d.label} ${d.icon} ${d.shape} ${d.note} ${d.decay ?? ''} token`).includes(q);

const wantFor = (t: Tab): ((c: Card) => boolean) =>
  t === 'parts'
    ? (c) => c.category === 'mech_part'
    : t === 'units'
      ? (c) => c.category === 'drone' || c.category === 'projectile'
      : t === 'tactics'
        ? (c) => c.category === 'tactics_or_upgrade'
        : (c) => c.category === 'pilot';

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
    factions: data.factions.filter((f) => matchFaction(f, q)).length,
    boxes: data.boxes.filter(isListedBox).filter((b) => matchBox(b, q)).length,
    rules:
      data.play.phases.filter((x) => matchPhase(x, q)).length +
      data.play.timings.filter((x) => matchTiming(x, q)).length +
      data.play.stances.filter((x) => matchStance(x, q)).length +
      data.mechanics.filter((m) => matchMechanic(m, q)).length +
      STATUSES.filter((d) => matchStatus(d, q)).length,
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
    missions: 'Missions', factions: 'Factions', boxes: 'Boxes', rules: 'Rules',
  };
  // Result rows, forum-style: one per line, name on the left and its kind on
  // the right, scanned top to bottom. Ten per group before the "all" link,
  // which is about a screen on a phone.
  const CAP = 10;
  const chip = (attr: string, title: string, sub: string): string =>
    `<button class="ref-hit" ${attr}><b>${esc(title)}</b><span>${esc(sub)}</span></button>`;
  type Group = { t: Tab; total: number; rows: string[] };
  const groups: Group[] = [];

  const kws = data.keywords.filter((k) => matchKeyword(k, q));
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
    const pool = data.cards.filter(wantFor(t)).filter((c) => matchCard(c, q))
      .sort((a, b) => cardName(a).localeCompare(cardName(b)));
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

  const mains = data.missions.cards.filter((m) => matchMission(m, q));
  const fams = data.missions.families.filter((f) => matchFamily(f, q));
  const secs = data.secondary.filter((s) => matchSecondary(s, q));
  if (mains.length + fams.length + secs.length) {
    const rows = [
      ...mains.map((m) => chip(`data-mission="${esc(m.id)}"`, m.name, 'Main Task')),
      ...secs.map((s) => chip(`data-secondary="${esc(s.id)}"`, s.name, 'Secondary Task')),
    ];
    groups.push({ t: 'missions', total: mains.length + fams.length + secs.length, rows: rows.slice(0, CAP) });
  }

  const facs = data.factions.filter((f) => matchFaction(f, q));
  if (facs.length) {
    groups.push({
      t: 'factions', total: facs.length,
      rows: facs.slice(0, CAP).map((f) => chip(`data-factionitem="${esc(f.key)}"`, f.name, 'faction')),
    });
  }

  const boxes = data.boxes.filter(isListedBox).filter((b) => matchBox(b, q)).sort((a, b) => a.id - b.id);
  if (boxes.length) {
    groups.push({
      t: 'boxes', total: boxes.length,
      rows: boxes.slice(0, CAP).map((b) => chip(`data-box="${esc(b.key)}"`, b.name.en || b.name.zh || b.key, 'box')),
    });
  }

  const mechs = data.mechanics.filter((m) => matchMechanic(m, q));
  const playBits =
    data.play.phases.filter((x) => matchPhase(x, q)).length +
    data.play.timings.filter((x) => matchTiming(x, q)).length +
    data.play.stances.filter((x) => matchStance(x, q)).length +
    STATUSES.filter((d) => matchStatus(d, q)).length;
  if (mechs.length + playBits) {
    // Mechanics are the chips worth naming; phases, timings, stances and
    // tokens count toward the total and live behind the group's Rules link.
    groups.push({
      t: 'rules', total: mechs.length + playBits,
      rows: mechs.slice(0, CAP).map((m) => chip('data-goto="rules"', m.name, m.ref ?? 'rules')),
    });
  }

  const total = groups.reduce((s, g) => s + g.total, 0);
  el.innerHTML = groups.length
    ? `<p class="ref-count">${total} match${total === 1 ? '' : 'es'} everywhere · tap an item to open it, a group or a tab to narrow</p>` +
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
    const list = data.keywords
      .filter((k) => matchKeyword(k, q))
      .sort((a, b) => (a.en?.name || a.key).localeCompare(b.en?.name || b.key));
    el.innerHTML = list.length
      ? `<p class="ref-count">${list.length} keyword${list.length === 1 ? '' : 's'}</p>${list.map(keywordCard).join('')}`
      : '<p class="ref-count">No matches</p>';
    return;
  }

  if (tab === 'missions') {
    const fam = new Map(data.missions.families.map((f) => [f.id, f]));
    const cards = data.missions.cards.filter((m) => matchMission(m, q));
    const fams = data.missions.families.filter((f) => matchFamily(f, q));
    const secs = data.secondary.filter((s) => matchSecondary(s, q));
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
        ? `<p class="ref-count">${secs.length} secondary task${secs.length === 1 ? '' : 's'} · you pick 1, scored privately</p>` +
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

  if (tab === 'rules') {
    const p = data.play;
    const phases = p.phases.filter((x) => matchPhase(x, q));
    const timings = p.timings.filter((x) => matchTiming(x, q));
    const stances = p.stances.filter((x) => matchStance(x, q));
    const filtered = data.mechanics.filter((m) => matchMechanic(m, q));

    const phaseHtml = phases.length
      ? `<p class="ref-count">Round phases</p>` +
        phases
          .map(
            (x) => `<article class="card">
              <div class="card-title"><span class="play-num">${x.order}</span>${esc(x.name)}</div>
              ${x.who ? `<div class="ref-note">${esc(x.who)}</div>` : ''}
              <div class="card-body">
                <p class="play-can"><b>You can</b></p><ul>${x.can.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul>
                <p class="play-cant"><b>You cannot</b></p><ul>${x.cannot.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul>
              </div>
              ${x.ref ? `<div class="card-foot"><span class="tag mono">${esc(x.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('')
      : '';

    const timingStrip =
      q || p.timings.length < 2
        ? ''
        : `<div class="tm-strip">${p.timings
            .map((x) => {
              const icon = actionIconUrl(TIMINGS.find((t) => t.id === x.id)?.pilotKey);
              return `<span class="tm-step" style="--t-tint: var(--t-${esc(x.id)})">
                ${icon ? `<img src="${icon}" alt="">` : ''}<b>${x.order}</b><span>${esc(x.name)}</span>
              </span>`;
            })
            .join('<i class="tm-arrow">▸</i>')}</div>`;

    const timingHtml = timings.length
      ? `<p class="ref-count">Action timings, in the order they resolve</p>` +
        timingStrip +
        timings
          .map((x) => {
            const def = TIMINGS.find((t) => t.id === x.id);
            const icon = actionIconUrl(def?.pilotKey);
            return `<article class="card tm-card" style="--t-tint: var(--t-${esc(x.id)})">
              <div class="card-title">
                ${icon ? `<img class="tm-icon" src="${icon}" alt="">` : ''}
                <span class="play-num tm-num">${x.order}</span><span class="tm-name">${esc(x.name)}</span> Timing
              </div>
              <div class="card-body">${linkKeywords(x.text)}</div>
            </article>`;
          })
          .join('') +
        (p.timingNotes && !q
          ? `<article class="card"><div class="card-title">How timings work</div>
              <div class="card-body"><ul>${p.timingNotes.lines.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul></div>
              ${p.timingNotes.ref ? `<div class="card-foot"><span class="tag mono">${esc(p.timingNotes.ref)}</span></div>` : ''}
            </article>`
          : '')
      : '';

    const stanceHtml = stances.length
      ? `<p class="ref-count">Stances</p>` +
        stances
          .map(
            (x) => `<article class="card">
              <div class="card-title">${esc(x.name)} <span class="tag mono">${esc(x.short)}</span></div>
              <div class="card-body">
                <p>${linkKeywords(x.effect)}</p>
                <p class="play-can"><b>Use it when</b> ${linkKeywords(x.good)}</p>
                <p class="play-cant"><b>Trade-off</b> ${linkKeywords(x.cost)}</p>
              </div>
              ${x.ref ? `<div class="card-foot"><span class="tag mono">${esc(x.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('') +
        (p.stanceNotes && !q
          ? `<article class="card"><div class="card-title">Choosing a stance</div>
              <div class="card-body"><ul>${p.stanceNotes.lines.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul></div>
              ${p.stanceNotes.ref ? `<div class="card-foot"><span class="tag mono">${esc(p.stanceNotes.ref)}</span></div>` : ''}
            </article>`
          : '')
      : '';

    const DURATION: Record<string, { label: string; text: string }> = {
      green: { label: 'Green', text: 'Stays in effect until an Action or effect removes it.' },
      yellow: {
        label: 'Yellow',
        text: 'Flipped to its red reverse at the end of the round, then removed at the end of the next one, so it lasts two rounds.',
      },
    };
    const tokenSvg = (def: StatusDef, red = false): string => {
      const tint = red ? '#e05c5c' : def.tint;
      const w = def.shape === 'triangle' ? 40 : def.shape === 'hexagon' ? 42 : 34;
      const body =
        def.shape === 'hexagon'
          ? `<polygon points="6,13 12,3 ${w - 12},3 ${w - 6},13 ${w - 12},23 12,23" fill="${tint}" stroke="#0f1216"/>`
          : def.shape === 'triangle'
            ? `<polygon points="${w / 2},2 ${w - 3},24 3,24" fill="${tint}" stroke="#0f1216"/>`
            : def.shape === 'round'
              ? `<rect x="3" y="4" width="${w - 6}" height="18" rx="9" fill="${tint}" stroke="#0f1216"/>`
              : def.shape === 'state'
                ? `<rect x="3" y="4" width="${w - 6}" height="18" rx="3" fill="${tint}" stroke="#0f1216" stroke-dasharray="3 2"/>`
                : `<rect x="3" y="4" width="${w - 6}" height="18" rx="2" fill="${tint}" stroke="#0f1216"/>`;
      return `<svg class="tok-badge" viewBox="0 0 ${w} 26" width="${w}" height="26" aria-hidden="true">${body}
        <text x="${w / 2}" y="17" text-anchor="middle" font-size="9" font-weight="700" fill="#0f1216">${esc(def.icon)}</text></svg>`;
    };
    const tokenList = STATUSES.filter((d) => matchStatus(d, q));
    const tokenHtml = tokenList.length
      ? `<p class="ref-count">Tokens and states</p>` +
        tokenList
          .map((d) => {
            const dur = d.decay ? DURATION[d.decay] : null;
            // The printed token, when we have it. The drawn badge below is our
            // own shorthand and was only ever a stand-in: showing both put a
            // made-up icon next to the real one and taught the wrong shape.
            // Camouflage and In smoke keep the badge, and should — they are
            // States (2.5.4), not tokens, and there is no printed piece to show.
            const print = TOKEN_PRINT[d.id] ?? [];
            return `<article class="card tok-card">
              <div class="card-title">
                <span class="tok-art">${
                  print.length
                    ? print.map((n) => `<img class="tok-print" src="${tokenPrintUrl(n)}" alt="">`).join('')
                    : tokenSvg(d) + (d.decay === 'yellow' ? tokenSvg(d, true) : '')
                }</span>
                ${esc(d.label)}
                ${
                  // THE SHAPE AND COLOUR CHIPS ARE GONE. Beside the printed
                  // token they were labelling what the picture already shows,
                  // and doing it worse: "square" and "Yellow" next to a
                  // photograph of a square yellow Fragile token is noise that
                  // reads as extra rules.
                  //
                  // `state` STAYS, because it is the one shape value that is
                  // not a shape: Camouflage and In smoke are States (2.5.4)
                  // with no printed piece at all, so the chip is the only thing
                  // saying which kind of thing this is.
                  //
                  // Nothing is lost with the other two: the body below still
                  // carries SHAPE_NOTE and the duration in prose, where they
                  // read as the rules they are.
                  d.shape === 'state' ? `<span class="tag mono">${esc(d.shape)}</span>` : ''
                }
              </div>
              <div class="card-body">
                <p>${linkKeywords(d.note)}</p>
                <p class="ref-note">${esc(SHAPE_NOTE[d.shape])}${dur ? ` ${esc(dur.text)}` : ''}</p>
              </div>
            </article>`;
          })
          .join('')
      : '';

    const mechanicHtml = filtered.length
      ? `<p class="ref-count">${filtered.length} mechanic${filtered.length === 1 ? '' : 's'}</p>` +
        filtered
          .map(
            (m) => `<article class="card">
              <div class="card-title">${esc(m.name)}</div>
              <div class="card-body">${linkKeywords(m.text)}</div>
              ${m.ref ? `<div class="card-foot"><span class="tag mono">${esc(m.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('')
      : '';

    // The publisher's own quick-reference cards. They answer the questions a
    // new player asks first - what happens this phase, what may this Mech do -
    // so they sit at the front of the Rules tab rather than at the bottom.
    const helpList = HELP_CARDS.filter(
      (h) => !q || h.name.toLowerCase().includes(q) || h.note.toLowerCase().includes(q),
    );
    const helpHtml = helpList.length
      ? `<p class="ref-count">Quick reference cards</p>` +
        `<div class="help-grid">${helpList
          .map(
            // No loading="lazy": on this page it stopped the fetch starting at
            // all (complete false, naturalWidth 0, and a zero-height box) even
            // with the figure in view. Four images that are the point of the
            // section do not want deferring anyway. width/height are the real
            // pixel size, so the grid reserves the box before the bytes land.
            (h) => `<figure class="help-card">
              <a href="${helpCardUrl(h.id)}" target="_blank" rel="noopener noreferrer"
                 title="Open ${esc(h.name)} full size">
                <img src="${helpCardUrl(h.id)}" alt="${esc(h.name)}" width="700" height="954" decoding="async">
              </a>
            </figure>`,
          )
          .join('')}</div>`
      : '';

    const sections = [
      { id: 'cards', label: 'Cards', n: helpList.length, html: helpHtml },
      { id: 'phases', label: 'Phases', n: phases.length, html: phaseHtml },
      { id: 'timings', label: 'Timings', n: timings.length, html: timingHtml },
      { id: 'stances', label: 'Stances', n: stances.length, html: stanceHtml },
      { id: 'tokens', label: 'Tokens', n: tokenList.length, html: tokenHtml },
      { id: 'mechanics', label: 'Mechanics', n: filtered.length, html: mechanicHtml },
    ];
    const total = sections.reduce((sum, x) => sum + x.n, 0);
    const chosen = sections.find((x) => x.id === rulesSection && x.n);
    const bar = `<div class="ref-facets ref-facets-faction">
      <button class="ref-facet${chosen ? '' : ' active'}" data-rules="">All <span class="fc-n">${total}</span></button>
      ${sections
        .map(
          (x) =>
            `<button class="ref-facet${chosen?.id === x.id ? ' active' : ''}${x.n ? '' : ' empty'}" data-rules="${x.id}"${
              x.n ? '' : ' disabled'
            }>${x.label} <span class="fc-n">${x.n}</span></button>`,
        )
        .join('')}
    </div>`;

    el.innerHTML = total
      ? bar + (chosen ? chosen.html : sections.map((x) => x.html).join(''))
      : bar + '<p class="ref-count">No matches</p>';
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
    const list = data.factions.filter((f) => matchFaction(f, q));
    el.innerHTML = list.length
      ? `<p class="ref-count">${list.length} faction${list.length === 1 ? '' : 's'} · tap one for its story</p>${list.map(factionRow).join('')}`
      : '<p class="ref-count">No matches</p>';
    return;
  }

  if (tab === 'boxes') {
    const sellable = data.boxes.filter(isListedBox);
    const pool = sellable.filter((b) => matchBox(b, q));
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

  const pool = data.cards.filter(wantFor(tab)).filter((c) => matchCard(c, q));

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

function fillPortraits(root: HTMLElement, lazy: boolean): void {
  root.querySelectorAll<HTMLElement>('[data-portrait]').forEach((slot) => {
    if (slot.childElementCount) return;
    const img = document.createElement('img');
    img.src = portraitUrl(slot.dataset.portrait!);
    img.alt = '';
    if (lazy) img.loading = 'lazy';
    img.addEventListener('error', () => slot.classList.add('portrait-missing'), { once: true });
    slot.appendChild(img);
  });
  root.querySelectorAll<HTMLElement>('[data-partart]').forEach((slot) => {
    if (slot.childElementCount) return;
    const id = slot.dataset.partart!;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    const sources = [mechPartUrl(id), tabImageUrl(id)];
    let next = 0;
    const advance = (): void => {
      if (next < sources.length) img.src = sources[next++];
      else slot.remove();
    };
    img.addEventListener('error', advance);
    advance();
    slot.appendChild(img);
  });
}

interface DetailView {
  kind: 'card' | 'keyword' | 'box' | 'faction';
  key: string;
  scroll?: number;
}

let navStack: DetailView[] = [];

const sheet = () => document.getElementById('ref-detail')!;
const sheetScroller = () => sheet().querySelector('.ref-detail-inner') as HTMLElement;

function viewHtml(v: DetailView): string | null {
  if (v.kind === 'card') {
    const c = data.byId.get(v.key);
    return c ? cardDetail(c) : null;
  }
  if (v.kind === 'box') return boxDetail(v.key);
  if (v.kind === 'faction') return factionDetail(v.key);
  return keywordDetail(v.key);
}

function viewLabel(v: DetailView): string {
  if (v.kind === 'card') return cardName(data.byId.get(v.key));
  if (v.kind === 'box') {
    const b = data.boxes.find((x) => x.key === v.key);
    return b ? b.name.en || b.name.zh || b.key : v.key;
  }
  if (v.kind === 'faction') return data.factions.find((x) => x.key === v.key)?.name ?? v.key;
  const def = data.keyword(v.key);
  return def?.en?.name?.replace(/^[•·\s]+/, '') || v.key;
}

function navigateDetail(kind: DetailView['kind'], rawKey: string): void {
  const key = kind === 'keyword' ? data.keyword(rawKey)?.key ?? rawKey : rawKey;
  const v: DetailView = { kind, key };
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
}

function backDetail(): void {
  if (navStack.length < 2) return closeDetail();
  navStack.pop();
  const prev = navStack[navStack.length - 1];
  const html = viewHtml(prev);
  if (html === null) return closeDetail();
  paintDetail(html, prev.scroll ?? 0);
}

// Switching tabs is pure DOM and never a re-render: repainting would remount
// the card image, restart its load and throw away the scroll position, for a
// change that only decides which of three panels is visible.
function showDetailTab(root: HTMLElement, which: string): void {
  root.querySelectorAll<HTMLElement>('[data-dtab]').forEach((b) => {
    const on = b.dataset.dtab === which;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  root.querySelectorAll<HTMLElement>('[data-dpanel]').forEach((p) => {
    p.hidden = p.dataset.dpanel !== which;
  });
  holdDetailHeight(root);
}

// THE SHEET KEEPS ITS SIZE ACROSS TABS. The three panels are different lengths,
// so switching threw the whole popup up and down the screen and moved the tab
// strip out from under the pointer that had just used it.
//
// The floor is the TALLEST panel seen so far rather than the tallest possible:
// measuring the hidden ones would mean unhiding, reading and rehiding all three
// on every switch, which is three forced reflows for a number that only ever
// grows. So it settles after the reader has visited the long tab once, and
// never shrinks back within a card.
function holdDetailHeight(root: HTMLElement): void {
  const open = root.querySelector<HTMLElement>('[data-dpanel]:not([hidden])');
  if (!open) return;
  // Read the CONTENT height with the floor lifted, or every measurement after
  // the first would just report the floor back to itself.
  root.style.setProperty('--dpanel-h', 'auto');
  const natural = open.scrollHeight;
  // THE RAW MAX IS STORED, THE CAP IS APPLIED ON THE WAY OUT. Storing the
  // capped value instead makes the floor ratchet DOWNWARD: each visit clamps
  // the previous clamp, so the tallest panel's height is forgotten and the
  // sheet ends up sized to whichever tab was seen last. That is the opposite of
  // what the floor is for.
  const raw = Math.max(natural, Number(root.dataset.panelMax ?? 0));
  root.dataset.panelMax = String(raw);

  // The cap is what stops the floor pushing the sheet past the window and
  // putting a scrollbar on a card that would otherwise fit. Measured from
  // `offsetTop` and the sheet's own max-height, both of which are independent
  // of the floor being set, so this cannot chase itself the way a measurement
  // off the live rect would.
  const scroller = root.closest('.ref-detail-inner') as HTMLElement | null;
  let cap = Infinity;
  if (scroller) {
    const cs = getComputedStyle(scroller);
    const maxH = parseFloat(cs.maxHeight);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    if (Number.isFinite(maxH)) cap = Math.max(200, maxH - open.offsetTop - padBottom);
  }
  root.style.setProperty('--dpanel-h', `${Math.min(raw, cap)}px`);
}

function paintDetail(html: string, scrollTop: number): void {
  const content = document.getElementById('ref-detail-content')!;
  content.innerHTML = html;
  content.querySelectorAll<HTMLElement>('[data-img]').forEach((slot) => {
    // Two slots hold the same scan now: the thumbnail on the Card tab and the
    // full one on the Photo tab. They take different classes because
    // `ref-cardimg` caps at 320px, which is the full view's size and eight
    // times the thumbnail's.
    const isThumb = !!slot.closest('.dthumb');
    // The thumbnail takes a COPY: the image cache holds one element per id, so
    // two slots sharing it would leave whichever mounted first empty.
    (isThumb ? mountCardImageCopy : mountCardImage)(slot, slot.dataset.img!, isThumb ? 'dthumb-img' : 'ref-cardimg');
    // 25 cards have no scan. mountCardImage drops the broken image but not the
    // caption beside it, which left those cards captioning a scan that is not
    // there. Cached images have already failed by now and fire no fresh event,
    // so the completed-but-empty case has to be tested directly.
    const img = slot.querySelector('img');
    // 25 cards have no scan. With the photo behind a tab, dropping the figure
    // is no longer enough: the TAB would still be there, promising a picture
    // and opening an empty panel. So the tab goes with it, and if the reader is
    // standing on that tab when the image fails they are put back on the Card.
    const drop = () => {
      slot.closest('.ref-scan')?.remove();
      // The thumbnail is a BUTTON that opens the Photo tab, so it has to go
      // with the tab it opens; left behind it would be a picture-shaped hole
      // leading nowhere.
      content.querySelector('.dthumb')?.remove();
      const tab = content.querySelector<HTMLElement>('[data-dtab="photo"]');
      const panel = content.querySelector<HTMLElement>('[data-dpanel="photo"]');
      if (tab) tab.hidden = true;
      if (panel && !panel.hidden) showDetailTab(content, 'card');
    };
    if (!img) { drop(); return; }
    if (img.complete && !img.naturalWidth) drop();
    else img.addEventListener('error', drop, { once: true });
  });
  // A card in no box at all still has a Boxes tab saying so in a sentence, but
  // an EMPTY panel would be a dead end, so that one is dropped outright.
  if (!content.querySelector('[data-dpanel="boxes"]')?.textContent?.trim()) {
    const t = content.querySelector<HTMLElement>('[data-dtab="boxes"]');
    if (t) t.hidden = true;
  }
  fillPortraits(content, false);
  sheet().hidden = false;
  document.body.classList.add('ref-locked');
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
  document.body.classList.remove('ref-locked');
  navStack = [];
}

function showMissionImage(id: string, kind: 'main' | 'secondary' = 'main'): void {
  const card =
    kind === 'secondary' ? data.secondary.find((s) => s.id === id) : data.missions.cards.find((m) => m.id === id);
  const src = kind === 'secondary' ? secondaryImageUrl(id) : missionImageUrl(id);
  document.querySelector('.mis-lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'mis-lightbox';
  box.innerHTML = `<div class="mis-lightbox-inner">
      <button class="mis-close" title="Close">✕</button>
      <img src="${src}" alt="${esc(card?.name ?? id)} card">
      <p>${esc(card?.name ?? id)}</p>
    </div>`;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('ref-locked');
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
  document.body.classList.add('ref-locked');
}

function keywordDetail(name: string): string | null {
  const def = data.keyword(name);
  if (!def) return null;
  const label = def.en?.name?.replace(/^[•·\s]+/, '') || def.key;
  const users = data.cards
    .filter((c) =>
      [...(c.keywords ?? []), ...((c.actions ?? []).flatMap((a) => a.keywords ?? []))].some(
        (k) => data.keyword(k.key || k.inline || k.en || '')?.key === def.key,
      ),
    )
    .slice(0, 40);
  return `<h2>${esc(label)}</h2>
    <p class="ref-meta">Keyword: rulebook glossary</p>
    <p>${def.en?.value ? linkKeywords(def.en.value) : '<em>No English glossary text.</em>'}</p>
    ${users.length ? `<h3 class="ref-sub">Appears on ${users.length}${users.length === 40 ? '+' : ''} card(s)</h3>
      <div class="ref-userlist">${users.map((c) => `<a class="ref-userlink" data-card="${esc(c.id)}">${esc(cardName(c))}</a>`).join('')}</div>` : ''}`;
}

async function init(): Promise<void> {
  data = await loadData();
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
    // The detail's own tabs, answered before anything else: they are buttons
    // inside a panel full of keyword links, and they navigate nowhere.
    const dtab = t.closest<HTMLElement>('[data-dtab]');
    if (dtab) {
      const root = document.getElementById('ref-detail-content');
      if (root) showDetailTab(root, dtab.dataset.dtab!);
      return;
    }
    const kw = t.closest<HTMLElement>('[data-kw]');
    if (kw) {
      ev.preventDefault();
      navigateDetail('keyword', kw.dataset.kw!);
      return;
    }
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
  document.getElementById('ref-detail-back')!.addEventListener('click', backDetail);
  document.getElementById('ref-detail-close')!.addEventListener('click', closeDetail);
  document.getElementById('ref-detail')!.addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeDetail();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDetail();
  });

  render();
}

init().catch((e) => {
  body().innerHTML = `<p class="ref-count">Failed to load: ${esc(String(e))}</p>`;
});
