// The card and keyword RENDERERS, shared by the reference page and the pad.
//
// These lived inside reference.ts, which has no exports at all - it is a
// side-effect entry point. That was fine while one page drew cards. The moment
// a second one did, copying them would have forked the thing that must never
// fork: linkKeywords decides WHAT LINKS TO WHAT, so two copies means a keyword
// quietly meaning one thing on the reference and another on the phone, and a
// glossary that drifts apart a line at a time.
//
// So there is one copy, here, and both pages import it. If a page needs
// different chrome, pass it in - do not branch on which page is asking.
//
// THE DATA IS INJECTED, not imported. loadData() is an async fetch and these
// are synchronous string builders called during a render; a module-level await
// here would make every importer async. Each page calls useCardData() once,
// after its own loadData() resolves and before it draws anything.
import { FACTION_LABEL, actionIconUrl, cardName, statIconIsPlated, statIconUrl, traitName, zeroCostReason, type BoxDef, type GameData, type KeywordDef } from './data';
import { LENGTH_NAME, TICK_COST, costLabel, lengthOf, timingOf } from './ticks';
import { diceRow, maskGlyphs, tickCapsule } from './glyphs';
import { linkIcon } from './icons';
import { type Card } from './types';

let data: GameData;

// The "which boxes hold this card" strip at the foot of a card. INJECTED rather
// than moved: it opens the reference's own Boxes tab and needs the whole box
// index behind it, which is a page feature and not a card renderer. A page that
// has no Boxes tab - the pad - passes nothing, and the strip is not drawn at
// all rather than drawn dead.
let boxRow: ((b: BoxDef) => string) | null = null;

// Called once per page, after loadData() resolves. The caches below are built
// from the card list on first use, so they are dropped here rather than left
// pointing at the previous database.
export function useCardData(d: GameData, opts?: { boxRow?: (b: BoxDef) => string }): void {
  data = d;
  boxRow = opts?.boxRow ?? null;
  linkPatterns = null;
  deployIndex = null;
  mechSeen = null;
}

export const SLOT_LABEL: Record<string, string> = {
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

// The boxed glyph printed beside a Drone action's name says when it happens.
export const SPEED_MARK: Record<string, { glyph: string; title: string; label: string }> = {
  auto: { glyph: '!', title: 'Automatic Action', label: 'Automatic Action' },
  command: { glyph: '?', title: 'Command Action', label: 'Command Action' },
  passive: { glyph: '∞', title: 'Passive', label: 'Passive' },
};

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

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

export function linkKeywords(text: string): string {
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

export function mechBlocks(...text: (string | undefined)[]): string {
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

export function keywordCard(k: KeywordDef): string {
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

export function kwLabel(k: { key?: string; en?: string; inline?: string }): string {
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

export function cardRow(c: Card): string {
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

export function cardDetail(c: Card): string {
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
        // The pool in the FACTION'S printed order: GoF leads with red, RDL
        // and UN with yellow. diceRow carries the evidence.
        diceRow(a.yellowDice, a.redDice, data.factionOf(c)),
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
        listsBoxes && boxRow
          ? `<div class="dboxcards">${inBoxes
              .filter((x) => x.def!.key !== 'UNSALE')
              .map((x) => boxRow!(x.def!))
              .join('')}</div>`
          : ''
      }
    </div>`;
}
