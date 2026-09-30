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
import { FACTION_LABEL, actionIconUrl, cardName, mechPartUrl, portraitUrl, statIconIsPlated, statIconUrl, tabImageUrl, traitName, zeroCostReason, type BoxDef, type ChangeEntry, type GameData, type KeywordDef, type MechanicDef, type RuleChange, type SeasonDef, type SeasonRule } from './data';
import { LENGTH_NAME, TICK_COST, costLabel, lengthOf, timingOf } from './ticks';
import { diceRow, maskGlyphs, tickCapsule, type CapsuleShort } from './glyphs';
import { linkIcon } from './icons';
import { printsWide } from './images';
import { matchMechanicBasic } from './refsearch';
import { type Card, type CardAction } from './types';

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
  xref = null;
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

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

let linkPatterns: { name: string; re: RegExp; len: number; lower: boolean }[] | null = null;
// Every card name as ONE alternation, longest first, and the id each stands
// for. One pass per text however many cards there are: the list grew from the
// Projectiles and Drones to every card (audit, 2026-09-30).
let cardPattern: RegExp | null = null;
const cardByName = new Map<string, string>();

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
// The source is ESCAPED by the time it gets here (linkKeywords runs esc first),
// and since the injection fix esc writes a straight quote as `&quot;`. The
// strip only knew the characters, so `MC-3 "Razor" Missile` stopped matching
// its card and the bare word Missile took the link instead, on every launcher
// (audit, 2026-09-30). The entities are quotes too.
const QUOTE = /["“”'‘’]/;
const QUOTE_ENTITY = /^&(?:quot|#39|#x27|apos);/;

function stripQuotes(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (QUOTE.test(s[i])) continue;
    if (s[i] === '&') {
      const ent = QUOTE_ENTITY.exec(s.slice(i, i + 7));
      if (ent) { i += ent[0].length - 1; continue; }
    }
    text += s[i];
    map.push(i);
  }
  return { text, map };
}

// Every link linkKeywords would paint in this text, in source order. Split out
// of the renderer rather than mirrored beside it, because the reference builds
// its "referenced by" index from the same answer: a keyword is listed as
// referencing this one exactly when a reader can SEE the link in its text and
// click it. A mirror could drift, and the drift would be invisible - the index
// would name a keyword whose text shows no link, or miss one it does.
function linkHits(src: string): { start: number; end: number; label: string; card?: boolean }[] {
  if (!linkPatterns) {
    const seen = new Set<string>();
    linkPatterns = [];
    // The name and every other name the publisher prints for it (aliases:
    // Indirect Fire beside Fire in arc), each linking to the one entry.
    for (const k of data.keywords) for (const raw of [k.en?.name, ...(k.aliases ?? [])]) {
      const n = raw?.replace(/^[•·\s]+/, '') ?? '';
      if (n.length < 3 || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      const body = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\bX\b/g, '\\d+');
      try {
        linkPatterns.push({ name: n, re: new RegExp(`\\b${body}\\b`, 'gi'), len: n.length, lower: n[0] === n[0].toLowerCase() && n[0] !== n[0].toUpperCase() });
      } catch {
      }
    }
    // THE THING ITSELF, not the word for it. "Launch 1 MC-3 "Razor" Missile"
    // used to link `Missile`, the keyword, when the reader almost certainly
    // wants the projectile the sentence names and which we hold a card for.
    // EVERY card now, not only what an Action launches: the Rules and the
    // glossary name Parts, pilots and Tactics Cards (the OCSP Overloading
    // Pack, Hammerhead, Additional Instructions), and each is a card a reader
    // can open (OTTO, 2026-09-30).
    //
    // The longest name wins a span, which is what makes `MC-3 "Razor" Missile`
    // (20 characters) beat `Missile` (7): hits are taken longest first below.
    // Where the text says only "Missile", the keyword still links.
    const names: string[] = [];
    for (const c of data.cards) {
      const n = stripQuotes((c.name?.en ?? '').trim()).text.replace(/\s+/g, ' ').trim();
      // Short names are the ones that collide with ordinary words; a keyword's
      // name is the keyword's. CJK is rejected for the usual reason: an `en`
      // field is not proof of English here.
      if (n.length < 8 || CJK.test(n) || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      cardByName.set(n.toLowerCase(), c.id);
      names.push(n);
    }
    names.sort((a, b) => b.length - a.length);
    try {
      cardPattern = names.length
        ? new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|'), 'gi')
        : null;
    } catch {
      cardPattern = null;
    }
    linkPatterns.sort((a, b) => b.len - a.len);
  }

  // Every candidate first, then the longest take their spans.
  const found: { start: number; end: number; label: string; card?: boolean; len: number }[] = [];
  // The quote-stripped copy, built once. Cards match against it; keywords match
  // the original, because a keyword name never contains a quote.
  const bare = stripQuotes(src);
  const word = /[A-Za-z0-9]/;
  if (cardPattern) {
    cardPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = cardPattern.exec(bare.text))) {
      if (!m[0]) { cardPattern.lastIndex++; continue; }
      // A whole name, not the inside of a longer word.
      const before = bare.text[m.index - 1];
      const after = bare.text[m.index + m[0].length];
      // A plural or a possessive still names the card ("GS-2 Smoke Grenades",
      // "the HD-2 Data Backpack's +1", whose apostrophe the strip took): one
      // trailing s is allowed, and stays outside the link.
      const after2 = bare.text[m.index + m[0].length + 1];
      const plural = after === 's' && !(after2 && word.test(after2));
      if ((before && word.test(before)) || (after && word.test(after) && !plural)) continue;
      // A card's name is printed with a capital, like a keyword's (below).
      if (/[a-z]/.test(m[0][0])) continue;
      const id = cardByName.get(m[0].replace(/\s+/g, ' ').toLowerCase());
      // A hit is in stripped coordinates and has to come back to real ones
      // before anything slices the source with it. `end` maps off the LAST
      // character rather than the one past it, which would run off the array
      // on a match that ends the string.
      const start = bare.map[m.index];
      const last = bare.map[m.index + m[0].length - 1];
      if (!id || start === undefined || last === undefined) continue;
      found.push({ start, end: last + 1, label: id, card: true, len: m[0].length });
    }
  }
  for (const { name, re, len, lower } of linkPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // A keyword is printed with a capital. The same word in lower case is
      // the ordinary word: "the hit Part", "a cruising Mech", "designate 1
      // enemy" are prose, and linking them sent readers to entries that were
      // not about what they were reading (audit, 2026-09-30).
      const first = m[0][0];
      if (!lower && first === first.toLowerCase() && first !== first.toUpperCase()) continue;
      found.push({ start: m.index, end: m.index + m[0].length, label: name, len });
    }
  }
  found.sort((a, b) => b.len - a.len || a.start - b.start);
  const hits: { start: number; end: number; label: string; card?: boolean }[] = [];
  for (const f of found) {
    if (!hits.some((h) => f.start < h.end && f.end > h.start)) hits.push({ start: f.start, end: f.end, label: f.label, card: f.card });
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

// The keyword names and card ids this text links to. `linkKeywords` paints
// them; this reports them, off the same hits.
export function linksIn(text: string): { keywords: string[]; cards: string[] } {
  const hits = linkHits(maskGlyphs(esc(text)).masked);
  return {
    keywords: [...new Set(hits.filter((h) => !h.card).map((h) => h.label))],
    cards: [...new Set(hits.filter((h) => h.card).map((h) => h.label))],
  };
}

// `own`: the keyword whose entry this text is. Its own name stays plain there:
// a link from an entry to itself goes nowhere (25 entries did it).
export function linkKeywords(text: string, own?: KeywordDef): string {
  // Glyph placeholders are masked out before the keyword pass, because several
  // of them ({Heavy Hit}, {Dodge}) are keyword names in their own right.
  const { masked: src, restore } = maskGlyphs(esc(text));
  const hits = linkHits(src).filter((h) => h.card || !own || data.keyword(h.label) !== own);
  if (!hits.length) return restore(src);

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
        // An entry with a basic view keeps its sources behind Advanced, so the
        // summary names the rule and nothing else.
        + `<summary><b>${esc(m.name)}</b>${m.ref && !m.basic ? ` <em>(${esc(m.ref)})</em>` : ''}</summary>`
        // linkKeywords runs on the BODY only. In the summary its [data-kw]
        // anchors would sit inside the toggle, so one tap would both open the
        // panel and navigate away from it.
        + `<div class="ref-mech-b">${mechanicBody(m)}</div>`
        + `</details>`,
    )
    .join('');
}

// A Mechanics entry in two layers: the basic view (what it is, then the rules
// a player needs most) and, behind Advanced, the full breakdown with its FAQ
// rulings and sources. An entry without a basic view draws its text as before.
// `q` is the Rules search: when only the Advanced text answers it, Advanced
// starts open so the match is on screen. `open`: always open, for the sheet the
// master changelog opens an entry in.
export function mechanicBody(m: MechanicDef, q = '', open = false): string {
  if (!m.basic) return ruleBlocks(m.text);
  const points = (m.points ?? []).map((p) => `<li>${linkKeywords(p)}</li>`).join('');
  const log = mechanicLog(m);
  const newest = newestOf(data.changelog?.rules?.[m.id] ?? []);
  return `<p class="mech-basic">${linkKeywords(m.basic)}</p>`
    + (points ? `<ul class="mech-points">${points}</ul>` : '')
    + seasonCallout(m)
    + `<details class="mech-adv"${open || !matchMechanicBasic(m, q) ? ' open' : ''}>`
    // The tag says there is a change inside while the section is closed.
    + `<summary>Advanced${newest ? ` <span class="mech-adv-new">Updated ${esc(versionLabel(newest))}</span>` : ''}</summary>`
    + `<div class="mech-adv-b">${log}${ruleBlocks(m.text)}</div>`
    + (m.ref ? `<p class="mech-src">${esc(m.ref)}</p>` : '')
    + `</details>`;
}

// A Rules entry's changelog (OTTO, 2026-09-30): at the TOP of Advanced, "so
// people see it first before reading on". One row per change, newest first,
// the revision in the amber badge and the source under the sentence. The
// basic view and the full text above and below it are already the current
// rule; this says what changed and when (data/changelog.json `rules`).
function mechanicLog(m: MechanicDef): string {
  const rows = ruleLogRows(data.changelog?.rules?.[m.id] ?? []);
  return rows ? `<div class="mech-log"><p class="mech-log-k">Changelog</p><ul class="ui-list mech-log-list">${rows}</ul></div>` : '';
}

function versionLabel(v: string): string {
  return (data.changelog?.versions ?? []).find((x) => x.id === v)?.label ?? v;
}

// The revisions in the order the data lists them, oldest first. A string sort
// happened to put 1.04 after 1.021; the list's own order is the one to trust.
function versionRank(v: string): number {
  return (data.changelog?.versions ?? []).findIndex((x) => x.id === v);
}

function newestOf(list: { v: string }[]): string | undefined {
  return [...list].sort((a, b) => versionRank(a.v) - versionRank(b.v)).pop()?.v;
}

// A changelog row (OTTO, 2026-09-30, Chips A of the design study): the
// revision's chip on its own line, the sentence under it at the row's full
// width, and where the change comes from under that, so every row's text starts
// at the same edge whatever its revision is called. Beside the text, "GoF
// 1.021" pushed its sentence further in than "1.04" did.
function logVer(v: string): string {
  return `<span class="log-ver">${esc(versionLabel(v))}</span>`;
}

// The rows a Rules entry and a glossary keyword share, newest first. `own`: the
// keyword whose sheet this is, which its own lines do not link.
function ruleLogRows(list: RuleChange[], own?: KeywordDef): string {
  return [...list].reverse()
    .map((e) => `<li>${logVer(e.v)}<div class="log-say">${linkKeywords(e.text, own)}</div>${
      e.source ? `<div class="log-src">${esc(e.source)}</div>` : ''}</li>`)
    .join('');
}

// A glossary keyword's changelog (data/changelog.json `keywords`): the closed
// bar a card carries under its stats, under the keyword's text, which is
// already the rule as it now stands.
export function keywordLog(def: KeywordDef): string {
  const list = data.changelog?.keywords?.[def.key] ?? [];
  const rows = ruleLogRows(list, def);
  if (!rows) return '';
  const newest = newestOf(list) ?? '';
  return `<details class="ref-log">
    <summary><span class="ref-log-k">Changelog</span><span class="ref-log-s">Changed in ${esc(versionLabel(newest))}</span><span class="ui-badge">${list.length}</span></summary>
    <div class="ref-log-b"><ul class="ui-list mech-log-list">${rows}</ul></div>
  </details>`;
}

// ---------- the master changelog (OTTO, 2026-09-30) ----------
//
// Every card, keyword and Rules entry one revision changed, in a sheet the Rules
// tab opens from a bar above the quick reference cards. A row names the thing,
// says what kind of change in a few short keys (or, for a card whose only change
// is its points, the two numbers), and a tap opens it with its own Changelog
// showing: nothing here repeats the detail.
const KEY_NAMES: Record<string, string> = {
  NEW: 'new to the game', NAME: 'a new name', PTS: 'points', STATS: 'a printed stat', ACTION: 'an Action',
  TEXT: 'its wording', TAG: 'no longer Low Value', CHANGED: 'the rule changed',
  CLARIFIED: 'spelled out, played the same', REVERSED: 'an old ruling undone', RETIRED: 'no longer a keyword',
  OPTIONAL: 'a Season Rule, not part of the main rules',
};
const KEY_ORDER = Object.keys(KEY_NAMES);
const KEY_TONE: Record<string, string> = { NEW: ' new', REVERSED: ' warn', RETIRED: ' warn', OPTIONAL: ' opt' };
const CARD_STATS = new Set(['armor', 'structure', 'parray', 'dodge', 'electronic', 'move']);
const ACTION_FIELDS = new Set(['range', 'dice', 'length', 'timing']);
// The phase order of the 1.04 record: GoF, PD, RDL, UN, Collab.
const FACTION_ORDER = ['GOF', 'PD', 'RDL', 'UN', 'COLLABORATION'];

// A card's keys, read off its entries for the revision.
function cardKeys(entries: ChangeEntry[]): string[] {
  const k = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'added') k.add('NEW');
    else if (e.kind === 'renamed' || e.kind === 'action-renamed') k.add('NAME');
    else if (e.field === 'score') k.add('PTS');
    else if (e.field && CARD_STATS.has(e.field)) k.add('STATS');
    else if (e.kind === 'action-added' || e.kind === 'action-removed' || (e.field && ACTION_FIELDS.has(e.field))) k.add('ACTION');
    else if (e.field === 'text' || e.field === 'trait') k.add('TEXT');
    else if (e.kind === 'low-value-lost') k.add('TAG');
  }
  return KEY_ORDER.filter((x) => k.has(x));
}

// A Rules entry's or a keyword's keys: the tags its lines carry, CHANGED where a
// line has none.
function lineKeys(list: RuleChange[]): string[] {
  const k = new Set(list.flatMap((e) => (e.tags?.length ? e.tags : ['CHANGED'])));
  return KEY_ORDER.filter((x) => k.has(x));
}

// The sheet carries no legend, so a key says what it means on hover.
function keyChips(keys: string[]): string {
  return keys.map((k) => `<span class="log-key${KEY_TONE[k] ?? ''}" title="${esc(KEY_NAMES[k] ?? k)}">${esc(k)}</span>`).join('');
}

// `kind` and `fac` label the row, and `sub` a Season Rule's kind of change; `pts`
// is a card's old and new points when its points are its only change; `attr` is
// what a tap asks the page to open.
interface IndexItem {
  name: string;
  keys: string[];
  attr: string;
  kind: 'rules' | 'keywords' | 'season' | 'cards';
  fac?: string;
  pts?: [number, number];
  sub?: string;
}
interface IndexGroup { title: 'Rules' | 'Keywords' | 'Season' | 'Cards'; fac?: string; items: IndexItem[] }

const byItemName = (a: IndexItem, b: IndexItem): number => a.name.localeCompare(b.name);

// One revision's changes: its Season Rules, Rules, Keywords, then the cards
// faction by faction.
export function changelogGroups(v: string): IndexGroup[] {
  const log = data.changelog;
  const rules: IndexItem[] = Object.entries(log?.rules ?? {}).flatMap(([id, list]) => {
    const m = data.mechanics.find((x) => x.id === id);
    const mine = list.filter((e) => e.v === v);
    return m && mine.length ? [{ name: m.name, keys: lineKeys(mine), attr: `data-logrule="${esc(m.id)}"`, kind: 'rules' as const }] : [];
  }).sort(byItemName);
  const kws: IndexItem[] = Object.entries(log?.keywords ?? {}).flatMap(([key, list]) => {
    const def = data.keyword(key);
    const mine = list.filter((e) => e.v === v);
    return def && mine.length
      ? [{ name: def.en?.name?.replace(/^[•·\s]+/, '') || def.key, keys: lineKeys(mine), attr: `data-logkw="${esc(def.key)}"`, kind: 'keywords' as const }]
      : [];
  }).sort(byItemName);
  // The season that came with this revision, as its own kind: its rules change
  // nothing in the main rules, so they are not listed among them.
  const season: IndexItem[] = ((data.seasons ?? []).find((s) => s.id === v)?.rules ?? [])
    .map((r) => ({ name: r.name, keys: ['OPTIONAL'], attr: `data-logseason="${esc(r.id)}"`, kind: 'season' as const, sub: seasonKind(r) }))
    .sort(byItemName);
  const byFac = new Map<string, IndexItem[]>();
  for (const [id, entries] of Object.entries(log?.cards ?? {})) {
    const c = data.byId.get(id);
    const mine = entries.filter((e) => e.v === v);
    if (!c || !mine.length) continue;
    const fac = data.factionOf(c) ?? '';
    const keys = cardKeys(mine);
    const score = mine.find((e) => e.field === 'score');
    const pts = keys.length === 1 && keys[0] === 'PTS' && typeof score?.from === 'number' && typeof score?.to === 'number'
      ? [score.from, score.to] as [number, number]
      : undefined;
    byFac.set(fac, [...(byFac.get(fac) ?? []), {
      name: cardName(c), keys, attr: `data-logcard="${esc(id)}"`, kind: 'cards', ...(fac ? { fac } : {}), ...(pts ? { pts } : {}),
    }]);
  }
  const rank = (f: string) => (FACTION_ORDER.includes(f) ? FACTION_ORDER.indexOf(f) : FACTION_ORDER.length);
  // The Season Rules lead (OTTO, 2026-09-30: "move the seasonal button and
  // items to the front"), under the line saying they are optional.
  const groups: IndexGroup[] = [];
  if (season.length) groups.push({ title: 'Season', items: season });
  if (rules.length) groups.push({ title: 'Rules', items: rules });
  if (kws.length) groups.push({ title: 'Keywords', items: kws });
  for (const fac of [...byFac.keys()].sort((a, b) => rank(a) - rank(b))) {
    groups.push({ title: 'Cards', ...(fac ? { fac } : {}), items: byFac.get(fac)!.sort(byItemName) });
  }
  return groups;
}

function countLine(groups: IndexGroup[]): string {
  const n = (t: IndexGroup['title']) => groups.filter((g) => g.title === t).reduce((s, g) => s + g.items.length, 0);
  return ([[n('Cards'), 'card'], [n('Keywords'), 'keyword'], [n('Rules'), 'rule'], [n('Season'), 'optional Season Rule']] as [number, string][])
    .filter(([k]) => k)
    .map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`)
    .join(' · ');
}

const itemCount = (groups: IndexGroup[]): number => groups.reduce((s, g) => s + g.items.length, 0);

// The revisions that changed anything, newest first.
function changedVersions(): { id: string; label: string; groups: IndexGroup[] }[] {
  return [...(data.changelog?.versions ?? [])].reverse()
    .map((x) => ({ id: x.id, label: x.label, groups: changelogGroups(x.id) }))
    .filter((x) => x.groups.length);
}

// The way in (Way in A of the design study): the card's closed Changelog bar,
// full width at the top of the Rules tab, naming the newest revision. It opens a
// sheet rather than folding open, so it wears the go chevron where the card's
// bar has its caret.
export function changelogEntry(): string {
  const newest = changedVersions()[0];
  if (!newest) return '';
  return `<button class="cl-entry" data-clv="${esc(newest.id)}">
    <span class="ref-log-k">Changelog</span>
    <span class="cl-entry-t">What changed in ${esc(newest.label)}</span>
    <span class="cl-entry-s">${esc(countLine(newest.groups))}</span>
    <span class="ui-badge">${itemCount(newest.groups)}</span><span class="ui-go" aria-hidden="true">›</span>
  </button>`;
}

// The sheet (Popup B of the design study): the revision as a pick beside the
// title, a search, the kinds as the facet chips with their counts, and one list
// with each row's kind above its name. The search and the chips work in place
// (reference.ts applyChangelogFilter), so typing never redraws the sheet.
export function changelogIndex(v: string): string | null {
  const all = changedVersions();
  const now = all.find((x) => x.id === v);
  if (!now) return null;
  const items = now.groups.flatMap((g) => g.items);
  const count = (k: IndexItem['kind']) => items.filter((i) => i.kind === k).length;
  // The revision is picked from our own menu under the title's pill: a native
  // select's list is drawn by the system, in its colours and not the site's
  // (OTTO, 2026-09-30: "more match our UI style"). Each revision carries its
  // count; reference.ts opens, walks and closes it.
  const pick = all.map((x) => `<button class="cl-ver-opt" type="button" role="menuitemradio" aria-checked="${x.id === v}" data-clver="${esc(x.id)}">`
    + `<span>${esc(x.label)}</span><span class="fc-n">${itemCount(x.groups)}</span></button>`).join('');
  const kinds = ([['all', 'All', items.length], ['season', 'Season', count('season')], ['rules', 'Rules', count('rules')], ['keywords', 'Keywords', count('keywords')], ['cards', 'Cards', count('cards')]] as [string, string, number][])
    .filter(([id, , n]) => id === 'all' || n)
    .map(([id, label, n]) => `<button class="ref-facet${id === 'all' ? ' active' : ''}${id === 'season' ? ' season' : ''}" data-clkind="${id}">${esc(label)} <span class="fc-n">${n}</span></button>`)
    .join('');
  const kindLabel = (i: IndexItem): string =>
    i.kind === 'rules' ? 'Rule' : i.kind === 'keywords' ? 'Keyword' : i.kind === 'season' ? `Season · ${i.sub ?? ''}`
      : i.fac ? `Card · ${FACTION_LABEL[i.fac] ?? i.fac}` : 'Card';
  // The Season Rules' rows open on a line saying what they are, so no one reads
  // a trial as a change to the main rules. It shows with them, not under a
  // search (reference.ts applyChangelogFilter).
  const note = '<li class="cl-note" data-clk="season" data-cln="">Season Rules are optional: a trial beside the main rules, not part of them.</li>';
  const rows = items.map((i, n) => (i.kind === 'season' && items[n - 1]?.kind !== 'season' ? note : '')
    + `<li class="tap" ${i.attr} data-clk="${i.kind}" data-cln="${esc(i.name.toLowerCase())}">`
    + `<span class="cl-name"><span class="cl-kind${i.kind === 'season' ? ' opt' : ''}"${i.fac ? ` data-fac="${esc(i.fac)}"` : ''}>${esc(kindLabel(i))}</span><span class="ui-row-name">${esc(i.name)}</span></span>`
    + (i.pts ? `<span class="log-pair"><s>${i.pts[0]}</s> → <b>${i.pts[1]}</b></span>` : `<span class="cl-keys">${keyChips(i.keys)}</span>`)
    + '<span class="ui-go" aria-hidden="true">›</span></li>').join('');
  return `<h2 class="cl-title">What changed <span class="cl-ver">`
    + `<button class="cl-ver-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Revision ${esc(now.label)}">${esc(now.label)}<span class="cl-ver-caret" aria-hidden="true">▾</span></button>`
    + `<span class="cl-ver-menu" role="menu" aria-label="Revisions" hidden>${pick}</span></span></h2>
    <p class="ref-meta">Changelog · publisher revisions</p>
    <label class="cl-q-label" for="cl-q">Search this revision</label>
    <input id="cl-q" class="cl-q" type="search" placeholder="Search this revision" autocomplete="off">
    <div class="ref-facets cl-kinds">${kinds}</div>
    <ul class="ui-list cl-list">${rows}</ul>
    <p class="cl-none" hidden>Nothing in ${esc(now.label)} matches that.</p>`;
}

// A Rules entry as a sheet, which only the master changelog opens: the entry as
// the Rules tab draws it, its Advanced open so its changelog is on screen.
export function ruleDetail(id: string): string | null {
  const m = data.mechanics.find((x) => x.id === id);
  if (!m) return null;
  return `<h2>${esc(m.name)}</h2><p class="ref-meta">Rules · Mechanics</p><div class="card-body ref-rule">${mechanicBody(m, '', true)}</div>`;
}

// ---------- the Season Rules (OTTO, 2026-09-30) ----------
//
// The publisher's Season Rules are a trial beside the main rules, never part of
// them, and OTTO: "We definitely want to make sure users realize that some
// changes are optional and not officially adjusted." So wherever one appears it
// is in blue, the OPTIONAL key's colour: the Rules tab's Season section opens on
// a banner saying so, each rule sets the main rules' value beside the Season's,
// and the Rules entry a Season Rule changes carries a callout to it, with its
// own text and changelog left as the main rule still stands.
export function currentSeason(): SeasonDef | undefined {
  const all = data.seasons ?? [];
  return all[all.length - 1];
}

function seasonOf(id: string): { s: SeasonDef; r: SeasonRule } | undefined {
  for (const s of [...(data.seasons ?? [])].reverse()) {
    const r = s.rules.find((x) => x.id === id);
    if (r) return { s, r };
  }
  return undefined;
}

const seasonKind = (r: SeasonRule): string => (r.kind === 'action' ? 'Action change' : 'Rule change');
const OPTIONAL_CHIP = '<span class="log-key opt" title="Not part of the main rules">OPTIONAL</span>';

// The banner a season's rules open on.
export function seasonAbout(s: SeasonDef): string {
  return `<article class="card season-about">
    <p class="season-k">${esc(s.label)} · Optional</p>
    <div class="card-title">Not part of the main rules</div>
    <div class="card-body"><p>${linkKeywords(s.about)}</p></div>
    <div class="card-foot"><span class="tag mono">${esc(s.ref)}</span></div>
  </article>`;
}

// What a Season Rule says, the same on its card and on its sheet: the short
// statement, the main rules' value beside the Season's, the points, and the
// Rules entries to read with it.
function seasonBody(r: SeasonRule, s: SeasonDef): string {
  const sees = [...(r.rule ? [r.rule] : []), ...(r.see ?? [])]
    .map((id) => data.mechanics.find((m) => m.id === id))
    .filter((m): m is MechanicDef => !!m)
    .map((m) => `<button class="season-see" data-rulesheet="${esc(m.id)}"><span>${esc(m.name)}${
      m.id === r.rule ? ' in the main rules' : ''}</span><span class="ui-go" aria-hidden="true">›</span></button>`)
    .join('');
  return `<p class="mech-basic">${linkKeywords(r.basic)}</p>`
    + `<div class="season-vs"><p class="season-vs-k">${esc(r.what)}</p>`
    + `<div class="season-vs-main"><span>Main rules</span><b>${esc(r.main)}</b></div>`
    + `<div class="season-vs-new"><span>${esc(s.label)}</span><b>${esc(r.season)}</b></div></div>`
    + `<ul class="mech-points">${r.points.map((p) => `<li>${linkKeywords(p)}</li>`).join('')}</ul>`
    + (sees ? `<div class="season-sees">${sees}</div>` : '');
}

export function seasonCard(r: SeasonRule, s: SeasonDef): string {
  return `<article class="card season-card">
    <p class="season-k">${esc(s.label)} · ${esc(seasonKind(r))}</p>
    <div class="card-title">${esc(r.name)} ${OPTIONAL_CHIP}</div>
    <div class="card-body">${seasonBody(r, s)}</div>
    <div class="card-foot"><span class="tag mono">${esc(r.ref)}</span></div>
  </article>`;
}

// A Season Rule as a sheet, which the master changelog and a Rules entry's
// callout open: what it is first, then the rule as its card draws it.
export function seasonDetail(id: string): string | null {
  const hit = seasonOf(id);
  if (!hit) return null;
  const { s, r } = hit;
  return `<h2>${esc(r.name)}</h2><p class="ref-meta season-meta">${esc(s.label)} · ${esc(seasonKind(r))}</p>
    <p class="season-banner">${OPTIONAL_CHIP}<span><b>Not part of the main rules.</b> ${linkKeywords(s.about)}</span></p>
    <div class="card-body ref-rule">${seasonBody(r, s)}</div>
    <p class="mech-src">${esc(r.ref)}</p>`;
}

// Under the points of the Rules entry a Season Rule changes. The entry's own
// text and changelog stay the main rule, which the Season did not change.
function seasonCallout(m: MechanicDef): string {
  const s = currentSeason();
  const r = s?.rules.find((x) => x.rule === m.id);
  if (!s || !r) return '';
  return `<button class="season-callout" data-season="${esc(r.id)}">`
    + `<span class="season-callout-t"><span class="season-k">${esc(s.label)} · Optional</span>${esc(r.basic)}</span>`
    + '<span class="ui-go" aria-hidden="true">›</span></button>';
}

// The Rules tab's way in, under the Changelog bar and in its shape, in the
// Season's blue. It narrows the tab to the Season section.
export function seasonEntry(): string {
  const s = currentSeason();
  if (!s?.rules.length) return '';
  return `<button class="cl-entry season-entry" data-rules="season">
    <span class="ref-log-k">Season Rules</span>
    <span class="cl-entry-t">${esc(s.label)} · optional</span>
    <span class="cl-entry-s">A trial beside the main rules, not part of them</span>
    <span class="ui-badge">${s.rules.length}</span><span class="ui-go" aria-hidden="true">›</span>
  </button>`;
}

// The full text in readable pieces: a blank line starts a paragraph, and lines
// that begin "- " are a list, which may follow a lead-in line in the same
// paragraph. OTTO (2026-09-25): one block of rulings was hard to read even
// behind Advanced.
export function ruleBlocks(text: string): string {
  let html = '';
  for (const block of text.split(/\n\s*\n/)) {
    let para: string[] = [];
    let items: string[] = [];
    const flush = (): void => {
      if (para.length) html += `<p>${linkKeywords(para.join(' '))}</p>`;
      if (items.length) html += `<ul class="mech-list">${items.map((i) => `<li>${linkKeywords(i)}</li>`).join('')}</ul>`;
      para = [];
      items = [];
    };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('- ')) {
        if (para.length) flush();
        items.push(line.slice(2));
      } else {
        if (items.length) flush();
        para.push(line);
      }
    }
    flush();
  }
  return html;
}

export function keywordCard(k: KeywordDef): string {
  const name = k.en?.name?.replace(/^[•·\s]+/, '') || k.key;
  const val = k.en?.value || '';
  const isTag = /tag on the card banner/.test(val);
  return `<article class="card card-tap" data-kwitem="${esc(name)}">
    <div class="card-title">${esc(name)}</div>
    <div class="card-body">${val ? linkKeywords(val, k) : '<em>No English glossary text for this keyword.</em>'}</div>
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

// ONE Action, drawn the way the card prints it. Split out of cardDetail so the
// pad can open a Part's actions inside its own row on the sheet with the same
// markup the reference draws - one renderer, two pages. Everything in here is
// exactly what the card detail's action loop did.
// `short` greys the capsule's Ticks the unit no longer has (the pad's free
// table, where the sheet knows what is left). Everywhere else it is omitted.
export function actionBlock(c: Card, a: CardAction, short?: CapsuleShort): string {
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
      ${tickCapsule(ticks, cost, short)}
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
}

// The Pilot Trait panel, split out for the same reason as actionBlock: the pad
// shows a pilot's trait under the pilot row of the sheet.
export function traitBlock(c: Card): string {
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
  return trait;
}

// ---------- the Changelog (OTTO, 2026-09-30) ----------
//
// What the publisher's list revisions have changed on this card since it was
// printed. The stat strip and the Actions above it always show the CURRENT
// values; this says which of them a printed card in someone's hand gets wrong,
// even where no new card art exists. Closed by default: a reader holding the
// card opens it, everyone else reads the current values and moves on.
// data/changelog.json, newest revision first. Every string is escaped here,
// and the text lines go through linkKeywords, which escapes as well.
const CHANGE_STAT: Record<string, string> = {
  score: 'Points', armor: 'Armor', structure: 'Structure', parray: 'Parry', dodge: 'Dodge', electronic: 'Electronic', move: 'Move',
};
const CHANGE_ACTION: Record<string, string> = { range: 'Range', dice: 'Dice', length: 'Length', timing: 'Timing' };
const LENGTH_WORD: Record<string, string> = { S: 'Short', M: 'Medium', L: 'Long' };

function changeValue(field: string, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '<span class="log-none">none</span>';
  // Dice the way the card draws them: "1Y2R" is {1Y}{2R} to the glyph pass.
  if (field === 'dice') return linkKeywords(String(v).replace(/(\d+)\s*([YRWB])/gi, '{$1$2}'));
  if (field === 'length') return esc(LENGTH_WORD[String(v).toUpperCase()] ?? String(v));
  return esc(String(v));
}

function changePair(field: string, e: ChangeEntry): string {
  return `<span class="log-pair"><s>${changeValue(field, e.from)}</s> → <b>${changeValue(field, e.to)}</b></span>`;
}

// A text change as its lines: reworded ones as Now over Was, then what the card
// gained, then what it lost.
function textLines(e: ChangeEntry): string {
  const line = (tag: string, html: string, was = false) =>
    `<p class="log-line${was ? ' log-was' : ''}"><span class="log-tag">${tag}</span><span>${html}</span></p>`;
  return [
    ...(e.changed ?? []).map(([was, now]) => line('Now', linkKeywords(now)) + line('Was', linkKeywords(was), true)),
    ...(e.gains ?? []).map((t) => line('Gains', linkKeywords(t))),
    ...(e.loses ?? []).map((t) => line('Loses', linkKeywords(t), true)),
  ].join('');
}

// One revision's changes to one card, as list rows: the card's own stats first,
// one row each with the numbers at the right; then ONE block per Action holding
// everything that Action changed, so a redesigned Action reads as one thing and
// not as five rows each repeating its name; then what left the card.
function changeRows(c: Card, entries: ChangeEntry[]): string {
  const note = (e: ChangeEntry) => (e.note ? `<small class="log-note">${esc(e.note)}</small>` : '');
  const out: string[] = [];
  for (const e of entries) {
    if (e.action) continue;
    if (e.field && CHANGE_STAT[e.field]) {
      out.push(`<li><span class="ui-row-name">${CHANGE_STAT[e.field]}${note(e)}</span><span class="ui-row-meta">${changePair(e.field, e)}</span></li>`);
    } else if (e.kind === 'renamed') {
      out.push(`<li><span class="ui-row-name">Renamed${note(e)}</span><span class="log-meta">was ${esc(String(e.from ?? ''))}</span></li>`);
    } else if (e.kind === 'low-value-lost') {
      out.push(`<li><span class="ui-row-name">No longer a Low Value unit${note(e)}</span></li>`);
    } else if (e.kind === 'added') {
      // A card a list adds has no printing to differ from, which is also why it
      // wears a drawn placeholder rather than a scan.
      out.push(`<li><span class="ui-row-name">New on the ${esc(e.list ?? '')} parts list${note(e)}</span></li>`);
    } else if (e.field === 'trait') {
      out.push(`<li class="log-text"><div class="ui-row-name">Trait${textLines(e)}${note(e)}</div></li>`);
    }
  }
  const byAction = new Map<string, ChangeEntry[]>();
  for (const e of entries) if (e.action) byAction.set(e.action, [...(byAction.get(e.action) ?? []), e]);
  for (const a of c.actions ?? []) {
    const es = byAction.get(a.id);
    if (!es) continue;
    const name = esc(a.name?.en || a.name?.zh || '');
    const lines = es.map((e) => {
      if (e.kind === 'action-added') return '<p class="log-line"><span class="log-tag">New</span><span>A new Action on this card</span></p>';
      if (e.kind === 'action-renamed') return `<p class="log-line"><span class="log-tag">Name</span><span>was ${esc(String(e.from ?? ''))}</span></p>`;
      if (e.field && CHANGE_ACTION[e.field]) return `<p class="log-line"><span class="log-tag">${CHANGE_ACTION[e.field]}</span>${changePair(e.field, e)}</p>`;
      if (e.field === 'text') return textLines(e);
      return '';
    }).join('');
    out.push(`<li class="log-text"><div class="ui-row-name">${name}${lines}${es.map(note).join('')}</div></li>`);
  }
  for (const e of entries) {
    if (e.kind === 'action-removed') {
      out.push(`<li><span class="ui-row-name">Action removed${note(e)}</span><span class="log-meta">${esc(e.name ?? '')}</span></li>`);
    }
  }
  return out.join('');
}

// What a card's revision rests on, for the head beside its chip: the version's
// `source`, "{faction}" standing for the card's own ("PD parts list 1.04").
function versionSource(c: Card, v: string): string {
  const src = (data.changelog?.versions ?? []).find((x) => x.id === v)?.source ?? '';
  if (!src.includes('{faction}')) return src;
  const fac = data.factionOf(c);
  if (fac) return src.replace('{faction}', FACTION_LABEL[fac] ?? fac);
  const bare = src.replace('{faction} ', '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export function changelogBlock(c: Card): string {
  const entries = data.changelog?.cards?.[c.id] ?? [];
  if (!entries.length) return '';
  const versions = data.changelog?.versions ?? [];
  const label = (v: string) => versions.find((x) => x.id === v)?.label ?? v;
  // Newest first, in the order the versions are listed.
  const order = [...new Set(entries.map((e) => e.v))]
    .sort((a, b) => versions.findIndex((x) => x.id === b) - versions.findIndex((x) => x.id === a));
  // Each revision as the Rules rows have it: its chip on its own line, the rows,
  // and what the change rests on under them ("PD parts list 1.04").
  const groups = order.map((v) => {
    const rows = changeRows(c, entries.filter((e) => e.v === v));
    const src = versionSource(c, v);
    return rows
      ? `<div class="log-rev">${logVer(v)}</div><ul class="ui-list ref-log-list">${rows}</ul>${src ? `<p class="log-src log-rev-src">${esc(src)}</p>` : ''}`
      : '';
  }).join('');
  if (!groups) return '';
  const points = entries.some((e) => e.field === 'score');
  // Said only where a value moved: a card new to a list has nothing printed on
  // it that is now wrong.
  const moved = entries.some((e) => !!e.field);
  const fresh = entries.every((e) => e.kind === 'added');
  const foot = moved
    // "The stats above", not "the card above": the thumbnail beside the name IS
    // the printed card, and pointing a reader at "the card" sends them to the
    // one place still showing the old values (OTTO, 2026-09-30).
    ? `<p class="ref-log-foot">The stats above show the current values; a printed card can show the older ones.${points ? ' Points are never printed on a card.' : ''}</p>`
    : '';
  return `<details class="ref-log">
    <summary><span class="ref-log-k">Changelog</span><span class="ref-log-s">${fresh ? 'New' : 'Changed'} in ${esc(label(order[0]))}</span><span class="ui-badge">${entries.length}</span></summary>
    <div class="ref-log-b">${groups}${foot}</div>
  </details>`;
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
  const actions = (c.actions ?? []).map((a) => actionBlock(c, a)).join('');
  // TWO names, and the split is the point. `traitZh` is the card's own Chinese
  // and is what decides whether there IS a trait and what the mechanics matcher
  // is fed; `traitShown` is what a reader sees. Merging them would either print
  // 功率隐匿 in an English detail view or hand "Stealth" to a matcher whose
  // patterns are Chinese — see Card.traitNameEn.
  const trait = traitBlock(c);
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
  // A Tactics Card prints no rules line of its own (its text is merged from
  // tactics.json as a single timing action), so nothing on it could name the
  // Tactics Cards entry and the entry reached no card at all. Its category
  // does, so the entry's own match term is handed in for it (audit Phase 6, J).
  const cardMechs = mechBlocks(c.description?.en, c.description?.zh, c.category === 'tactics_or_upgrade' ? 'tactics card' : undefined);
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
  // What the placeholder shows when the card has no scan (images.ts). An
  // attribute, so the quotes several card names print are escaped as well.
  const phAttrs = `data-img-label="${esc(cardName(c)).replace(/"/g, '&quot;')}"${printsWide(c) ? ' data-img-wide="1"' : ''}`;
  return `<div class="dhead">
    ${wantsThumb ? `<button class="dthumb" data-dtab="photo" title="See the printed card"><span class="ref-cardimg-slot" data-img="${esc(c.id)}" ${phAttrs}></span></button>` : ''}
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
      ${c.category === 'pilot' ? `<div class="ref-portrait" data-portrait="${esc(c.id)}" data-portrait-label="${esc(cardName(c)).replace(/"/g, '&quot;')}"></div>` : ''}
      ${free ? `<p class="ref-free">Costs 0 points: ${esc(free)}.</p>` : ''}
      ${stats || pilotStats ? `<div class="ref-stats">${stats}${pilotStats}</div>` : ''}
      ${changelogBlock(c)}
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
        <div class="ref-cardimg-slot" data-img="${esc(c.id)}" ${phAttrs}></div>
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

// ---------- portraits and part art, filled after a paint ----------
//
// Moved to its own file (cardart.ts) so the tabletop's Mech builder can have
// it without this whole renderer; re-exported so every page that imports it
// from here still does.
export { fillPortraits } from './cardart';

// WHICH KEYWORDS AND CARDS NAME EACH KEYWORD, built once for the whole
// glossary rather than per sheet: it is one pass over every keyword's text and
// every card's rule text, and reading one keyword should not pay for it again.
// Dropped by useCardData, which is the only place the database can change.
let xref: { kw: Map<string, string[]>; cards: Map<string, string[]> } | null = null;

export function crossRefs(): { kw: Map<string, string[]>; cards: Map<string, string[]> } {
  if (xref) return xref;
  const kw = new Map<string, string[]>();
  const cards = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, v: string) => {
    const at = m.get(key);
    if (at) { if (!at.includes(v)) at.push(v); } else m.set(key, [v]);
  };
  // A keyword naming ITSELF is not a cross-reference, and several do: the
  // glossary entry for Throw opens by saying "Throw".
  for (const k of data.keywords) {
    for (const named of linksIn(k.en?.value ?? '').keywords) {
      const hit = data.keyword(named);
      if (hit && hit.key !== k.key) push(kw, hit.key, k.key);
    }
  }
  for (const c of data.cards) {
    // The chips this card already prints. A card in the "Appears on" list is
    // not news in the "named in the text of" one.
    const printed = new Set<string>();
    for (const k of [...(c.keywords ?? []), ...((c.actions ?? []).flatMap((a) => a.keywords ?? []))]) {
      const hit = data.keyword(k.key || k.inline || k.en || '');
      if (hit) printed.add(hit.key);
    }
    const text = [
      c.description?.en ?? '',
      ...(c.actions ?? []).map((a) => a.description?.en ?? ''),
    ].filter(Boolean).join(' \u00b7 ');
    if (!text) continue;
    for (const named of linksIn(text).keywords) {
      const hit = data.keyword(named);
      if (hit && !printed.has(hit.key)) push(cards, hit.key, c.id);
    }
  }
  xref = { kw, cards };
  return xref;
}

// The keyword SHEET: the glossary text, the keywords it names and every card
// it appears on. The reference's detail panel and the pad's draw the same one.
export function keywordDetail(name: string): string | null {
  const def = data.keyword(name);
  if (!def) return null;
  const label = def.en?.name?.replace(/^[•·\s]+/, '') || def.key;
  const refs = crossRefs();
  const related = (refs.kw.get(def.key) ?? [])
    .map((k) => data.keyword(k))
    .filter((k): k is NonNullable<typeof k> => !!k);
  // ONE list. A card that prints the chip and a card whose rules text merely
  // says the word are both "cards this keyword is on" to a reader, and two
  // headings made them look like different kinds of answer. The printed ones
  // lead because that is the stronger claim, but nothing labels them apart.
  // An Action NAMED after a keyword is that keyword's ability printed as an
  // Action, so it counts as printing it: Dense Armor since the Supplementary
  // Rules 1.04 (3.7) retired the keyword for exactly that, and KC Armor and
  // Fire Control Interference all along. Not for a banner tag, where an Action
  // called Missile or Grenade names what it launches, not a rule.
  const isTag = /tag on the card banner/.test(def.en?.value ?? '');
  const names = new Set([label, ...(def.aliases ?? [])].map((n) => n.trim().toLowerCase()));
  const named = (c: Card) => !isTag && (c.actions ?? []).some((a) => names.has((a.name?.en ?? '').trim().toLowerCase()));
  const prints = data.cards.filter((c) =>
    named(c) || [...(c.keywords ?? []), ...((c.actions ?? []).flatMap((a) => a.keywords ?? []))].some(
      (k) => data.keyword(k.key || k.inline || k.en || '')?.key === def.key,
    ));
  const says = (refs.cards.get(def.key) ?? [])
    .map((id) => data.byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c && !prints.includes(c));
  const users = [...prints, ...says];
  const shown = users.slice(0, 40);
  const cardLink = (c: { id: string }) =>
    `<a class="ref-userlink" data-card="${esc(c.id)}">${esc(cardName(data.byId.get(c.id)))}</a>`;
  const kwName = (k: KeywordDef) => k.en?.name?.replace(/^[•·\s]+/, '') || k.key;
  return `<h2>${esc(label)}</h2>
    <p class="ref-meta">Keyword: rulebook glossary</p>
    <p>${def.en?.value ? linkKeywords(def.en.value, def) : '<em>No English glossary text.</em>'}</p>
    ${keywordLog(def)}
    ${related.length ? `<h3 class="ref-sub">Related keywords</h3>
      <div class="ref-userlist">${related
        .map((k) => `<a class="ref-userlink kw" data-kw="${esc(kwName(k))}">${esc(kwName(k))}</a>`)
        .join('')}</div>` : ''}
    ${users.length ? `<h3 class="ref-sub">Appears on ${users.length} card(s)</h3>
      <div class="ref-userlist">${shown.map(cardLink).join('')}</div>` : ''}`;
}
