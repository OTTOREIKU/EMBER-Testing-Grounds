// TWO READABILITY RULES FOR THE REFERENCE (OTTO, 2026-08-24).
//
// 1. A rulebook definition is FOLDED AWAY BY DEFAULT. Printing every glossary
//    entry in full under every card that mentions it buried the card's own
//    text: a Main Task is three lines of its own rules followed by a paragraph
//    of Black Box, and it is the same paragraph on all three Black Box
//    missions. The summary still names the rule and its rulebook reference, so
//    what is hidden is the wording and never the fact that a rule applies.
//
// 2. NO NON-ENGLISH TEXT WHERE A COMPLETE ENGLISH EXISTS. The mission cards
//    carry a `nameKo` beside a full English `name`, and it was being drawn on
//    both the reference and the board. It stays in the DATA (it is the printed
//    language, so it is provenance) and it stays in the SEARCH haystack, which
//    costs a reader nothing and lets them find a card by its Korean name.
//
// Source-shape rather than DOM-driven: reference.ts has no bundling harness of
// its own, and both rules are about what the renderer WRITES. The browser check
// that the panels really collapse was done by hand at the time.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Reference readability: folded definitions, English only\n');

const ref = readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/reference.css', import.meta.url), 'utf8');
const missions = JSON.parse(readFileSync(new URL('../../data/missions.json', import.meta.url), 'utf8'));
const secondary = JSON.parse(readFileSync(new URL('../../data/secondary.json', import.meta.url), 'utf8'));

// ---------- 1. the collapsible panel ----------
const mech = /function mechBlocks[\s\S]*?\n}/.exec(ref)?.[0] ?? '';
check('mechBlocks still exists', mech.length > 0, true);
check('a definition is a details panel', /<details class="ref-mech">/.test(mech), true);
check('with a summary', /<summary>/.test(mech), true);
// CLOSED BY DEFAULT is the whole request. `<details open>` would render the old
// always-visible block while passing every other assertion here.
check('and it is CLOSED by default, which is the point', /<details class="ref-mech"[^>]*\bopen\b/.test(mech), false);
// The name and the rulebook reference stay visible, so a reader can see THAT a
// rule applies without opening anything.
check('the summary names the rule', /<summary><b>\$\{esc\(m\.name\)\}/.test(mech), true);
check('and carries the rulebook reference', /<summary>[\s\S]*?esc\(m\.ref\)/.test(mech), true);
check('the wording lives in the body', /class="ref-mech-b">\$\{linkKeywords\(m\.text\)\}/.test(mech), true);
// KEYWORD LINKS MUST NOT SIT IN THE TOGGLE. linkKeywords writes [data-kw]
// anchors, and the document-level delegation turns those into navigation, so a
// tap on the summary would open the panel and leave the page at once.
check('linkKeywords never runs on the summary',
  /<summary>[\s\S]*?linkKeywords[\s\S]*?<\/summary>/.test(mech), false);

// ONE function feeds every rulebook definition on the page, which is what makes
// "this goes for every type" true rather than a list someone has to maintain.
const callers = (ref.match(/mechBlocks\(/g) ?? []).length - 1;
check('every definition on the page comes through it', callers >= 6, true);

// The affordance has to be visible: a summary that looks like a heading is a
// panel nobody opens.
check('the summary is styled as a control', /\.ref-mech > summary \{[^}]*cursor: pointer/.test(css), true);
check('the default triangle is replaced, not merely hidden',
  /\.ref-mech > summary::after \{[^}]*content: '▾'/.test(css), true);
check('and the marker turns when open', /\.ref-mech\[open\] > summary::after/.test(css), true);
check('motion is dropped for anyone who asked for that',
  /prefers-reduced-motion[\s\S]{0,140}\.ref-mech > summary::after \{ transition: none/.test(css), true);

// ---------- 2. English only where English is complete ----------
// The data is unchanged: this is a display rule, not a deletion.
const cards = missions.cards ?? [];
check('the mission data still carries its Korean', cards.some((c) => c.nameKo), true);
check('and every card carrying one also has a full English name',
  cards.filter((c) => c.nameKo).every((c) => (c.name ?? '').trim().length > 0), true);
const secCards = secondary.cards ?? [];
check('same for the secondary tasks',
  secCards.filter((s) => s.nameKo).every((s) => (s.name ?? '').trim().length > 0), true);
check('and there are some to check', secCards.some((s) => s.nameKo), true);

// NOT RENDERED anywhere. Counted rather than pattern-matched so a new draw site
// added later fails this rather than slipping through a regex written for the
// old ones.
const drawn = (src) => (src.match(/nameKo/g) ?? []).length;
// reference.ts keeps exactly two: both are search haystacks.
const refUses = ref.match(/^.*nameKo.*$/gm) ?? [];
check('the reference reads nameKo only twice', refUses.length, 2);
check('and both are the SEARCH haystack, never markup',
  refUses.every((L) => /norm\(/.test(L) && !/<[a-z]/.test(L)), true);
check('the board draws it nowhere at all', drawn(main), 0);

// The search is the reason the field is worth keeping in the reader's reach: a
// player looking at a Korean card can still find it here.
check('a mission is still findable by its Korean name',
  /matchMission[\s\S]{0,200}m\.nameKo/.test(ref), true);
check('and so is a secondary task',
  /matchSecondary[\s\S]{0,200}s\.nameKo/.test(ref), true);

// The wider rule: Chinese still appears ONLY as a fallback when English is
// missing, which is a different thing from printing both.
const bothShown = (ref.match(/\$\{esc\([^)]*\.en[^)]*\)\}[^`]{0,40}\$\{esc\([^)]*\.zh/g) ?? []);
check('no renderer prints English and Chinese side by side', bothShown.length, 0);

// ---------- THE CARD DETAIL, option F ----------
const data = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const images = readFileSync(new URL('../src/images.ts', import.meta.url), 'utf8');

// THE ICON RULE, and it is the one that bit. Every icon file is RGBA, but four
// of them (armor, dodge, electronic, parray) have the printed BOX baked into
// the alpha, so masking one paints a solid square: those four stat cells drew
// as blank plates. Judge the ALPHA, not the colour - reading mean luminance of
// the opaque pixels averages the plate in with the ink and says the opposite.
check('the plated icons are named', /PLATED_ICONS = new Set\(\[/.test(data), true);
check('and they are exactly the four with a baked box',
  ['armor', 'dodge', 'electronic', 'parray'].every((n) => new RegExp(`'${n}'`).test(/PLATED_ICONS = new Set\(\[[^\]]*\]/.exec(data)[0])), true);
check('a plated stat is drawn as an image, never masked',
  /statIconIsPlated\(field\)\s*\?\s*`<img class="stat-plate"/.test(ref), true);
check('and an unplated one is masked', /: `<span class="stat-mark"/.test(ref), true);

// STRUCTURE HAS NO GLYPH ON THE CARD: it prints as a bare dark box holding the
// number. Our data was borrowing Armor's icon for it, so the two sat adjacent
// looking identical.
check('structure gets the printed boxed numeral', /field === 'structure'/.test(ref), true);
check('with no icon beside it',
  /field === 'structure'\)\s*\{[\s\S]{0,200}?\}/.exec(ref)[0].includes('stat-plate'), false);

// ONE IMG ELEMENT PER ID is the image cache's whole design, so two slots showing
// the same card cannot share it: the second replaceChildren moves the element
// out of the first and that slot silently empties.
check('a second view of one card mounts its own element', /export function mountCardImageCopy/.test(images), true);
check('and the thumbnail uses it', /isThumb \? mountCardImageCopy : mountCardImage/.test(ref), true);

// The sheet must not resize as the reader moves between tabs.
check('the panel holds a height floor', /--dpanel-h/.test(ref), true);
check('measured with the floor lifted, or it reports itself back',
  /setProperty\('--dpanel-h', 'auto'\)[\s\S]{0,200}?scrollHeight/.test(ref), true);
check('and the floor is cleared for each fresh card',
  /removeProperty\('--dpanel-h'\)/.test(ref), true);
// THE RAW MAX IS STORED AND THE CAP APPLIED ON THE WAY OUT. Storing the capped
// value makes the floor ratchet DOWNWARD - each visit clamps the previous
// clamp - so the tallest panel's height is forgotten and the sheet ends up
// sized to whichever tab was looked at last.
check('the remembered max is the RAW height', /dataset\.panelMax = String\(raw\)/.test(ref), true);
check('and the cap is applied only when writing',
  /Math\.min\(raw, cap\)/.test(ref), true);
// The cap is what stops the floor pushing the sheet past the window and putting
// a scrollbar on a card that would otherwise fit.
check('the cap comes off the sheet max-height, not the live rect',
  /parseFloat\(cs\.maxHeight\)[\s\S]{0,220}?open\.offsetTop/.test(ref), true);
check('the remembered max resets with the card', /delete content\.dataset\.panelMax/.test(ref), true);
check('and is re-measured when the window changes',
  /addEventListener\('resize'[\s\S]{0,600}?holdDetailHeight/.test(ref), true);
check('the panel CSS reads it', /\.dpanel \{ min-height: var\(--dpanel-h/.test(css), true);

// A tab that opens an empty panel is a dead end, so it goes with its content.
check('a missing scan hides the Photo tab', /\[data-dtab="photo"\][\s\S]{0,120}?hidden = true/.test(ref), true);
check('and takes the thumbnail with it', /querySelector\('\.dthumb'\)\?\.remove\(\)/.test(ref), true);
check('an empty Boxes panel hides its tab too', /data-dpanel="boxes"[\s\S]{0,180}?dtab="boxes"/.test(ref), true);


// ---------- ORDER: the card's own notes go BELOW the actions ----------
// They used to sit between the stats and the actions, putting a paragraph of
// rulebook definition in front of the thing the reader opened the card for -
// and the card's keyword banner repeats keywords the actions print for
// themselves, so every weapon led with a list it was about to give again.
const panel = /data-dpanel="card"[\s\S]*?\n    <\/div>/.exec(ref)?.[0] ?? '';
check('the card panel was found', panel.length > 0, true);
check('actions come before the foot', panel.indexOf('ref-sub">Actions') < panel.indexOf('class="dfoot"'), true);
check('and the keyword links are in the foot, not the top',
  /class="dfoot"[\s\S]*?ref-kwlinks/.test(panel) && !/dtop-b[\s\S]{0,300}?ref-kwlinks/.test(panel), true);
check('the card-level rules block sits there too', /class="dfoot"[\s\S]*?\$\{cardBlock\}/.test(panel), true);

// A definition is worth repeating under each ACTION that needs it, but not at
// card level under one an action already showed.
check('repeats are dropped once seen', /mechSeen\.has\(m\.name\)/.test(ref), true);
check('the window opens before the actions are built',
  ref.indexOf('mechSeen = new Set<string>()') < ref.indexOf('const actions = (c.actions'), true);
// Module state left open would carry one card's answer into every list drawn
// after it.
check('and closes again when the card is done', /mechSeen = null;/.test(ref), true);

// The Photo tab caption is gone.
check('the photo needs no caption', /ref-scan-note">The printed card/.test(ref), false);

// ---------- the printed speed marks ----------
// ZHDR-201 draws |TEAR| and |MISSILE| on BLACK bars: a Command or Automatic
// action is not taken on the Timing Dial, so it gets no timing colour. Ours
// tinted them by type, which put the Command mark's blue on the blue Movement
// bar where it vanished.
check('a dial-less action takes no timing tint', /const timing = dialless \? undefined : timingOf\(a\)/.test(ref), true);
check('and is marked so the bar can go black', /dialless \? ' t-dialless'/.test(ref), true);
check('the black bar is styled', /\.ref-action\.t-dialless \.ra-h \{ --tint: #14171c/.test(css), true);
// The marks themselves, and the SAME rule on both pages: one mark, one meaning.
const boardCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const printedMark = (s) => /\.act-speed\.sp-auto,\s*\r?\n\.act-speed\.sp-command \{[^}]*background: #eaeaf5[^}]*color: #14171c/.test(s);
check('the reference draws the printed mark', printedMark(css), true);
check('and so does the board', printedMark(boardCss), true);
check('neither keeps the old amber', /sp-auto \{ background: rgba\(240, 180, 41/.test(css + boardCss), false);
check('nor the old blue', /sp-command \{ background: rgba\(101, 162, 216/.test(css + boardCss), false);


// ---------- the thumbnail rides the TITLE, and pilots have none ----------
// It sat above the stat strip and cost the strip a third of its width, which
// squeezed the long labels (PROJECTILE, ELECTRONIC) into their neighbours.
check('the thumbnail is in the title row', /class="dhead">[\s\S]{0,260}?class="dthumb"/.test(ref), true);
check('and no longer above the strip', /class="dtop">[\s\S]{0,200}?class="dthumb"/.test(ref), false);
// A pilot's portrait is already a headshot of the same person in the same
// place, so a card thumbnail beside it is the same picture twice.
check('pilots are excluded by name', /wantsThumb = c\.category !== 'pilot'/.test(ref), true);
check('and the thumbnail is gated on it', /\$\{wantsThumb \? `<button class="dthumb"/.test(ref), true);

// Cells size from CONTENT, so one is never narrower than the word inside it.
check('stat cells size to their content', /\.ref-stats \.ds \{[^}]*min-width: fit-content/.test(css), true);
// The superseded declaration is REMOVED, not merely overridden: a retired rule
// that still matches is a live override, which is how the old pill styling came
// to beat the new masked icon.
check('and no longer divide the row evenly off a fixed floor',
  /\.ref-stats \.ds \{[^}]*flex: 1 1 0;/.test(css), false);
check('with exactly one rule sizing the cell',
  (css.match(/^\.ref-stats \.ds \{/gm) ?? []).length, 1);

// The Photo tab exists to look at the card, so the card takes the panel.
check('the photo scales to the panel', /\[data-dpanel="photo"\] \.ref-cardimg \{[^}]*max-height: calc\(var\(--dpanel-h/.test(css), true);
check('bounded by the same floor the panel holds, so the two cannot chase each other',
  /\[data-dpanel="photo"\] \.ref-cardimg \{[^}]*max-width: 100%/.test(css), true);


// ---------- THE "TRANSLATED" NOTE KEYS ON PROVENANCE ----------
// 61 actions printed "(translated from the Chinese card text)" and 55 of them
// were marked `printed` in action_translations.json: read off the ENGLISH card.
// The note was not merely noise there, it was false. The data had recorded the
// answer in `confidence` all along and the renderer ignored it.
const xlate = JSON.parse(readFileSync(new URL('../../data/action_translations.json', import.meta.url), 'utf8'));
const conf = Object.values(xlate.translations).filter((v) => v.english).map((v) => String(v.confidence));
check('the file records provenance per entry', conf.length > 0, true);
check('and marks most of them as printed', conf.filter((c) => c.startsWith('printed')).length > 0, true);

check('the renderer reads the confidence', /const conf = String\(tr\.confidence/.test(ref), true);
check('a printed entry gets NO note', /conf === 'printed'\s*\?\s*''/.test(ref), true);
// printed-truncated IS printed, just cut off, so it earns a note but not that
// note: the tail is completed from the Chinese, the whole line is not a
// translation.
check('a truncated one says what actually happened',
  /conf\.startsWith\('printed'\)[\s\S]{0,200}?runs off the card/.test(ref), true);
check('and only a real translation still claims to be one',
  /translated from the Chinese card text/.test(ref), true);
check('the entry\'s own note rides along as a tooltip', /tr\.note \? ` title="\$\{esc\(tr\.note\)\}"/.test(ref), true);

// ---------- LINK THE THING, NOT THE WORD FOR IT ----------
// "Launch 1 MC-3 "Razor" Missile" linked `Missile`, the keyword, when the
// reader wants the projectile the sentence names and that we hold a card for.
check('projectiles and drones join the link patterns',
  /c\.category !== 'projectile' && c\.category !== 'drone'/.test(ref), true);
check('and emit a card link rather than a keyword one',
  /h\.card[\s\S]{0,120}?data-card="\$\{esc\(h\.label\)\}"/.test(ref), true);
// Longest-first is what lets the card beat the keyword for the same span.
check('patterns sort by the matched NAME length', /sort\(\(a, b\) => b\.len - a\.len\)/.test(ref), true);
check('never by the pattern source, which quoteLoose inflates',
  /sort\(\(a, b\) => b\.re\.source\.length/.test(ref), false);

// THE QUOTE HAZARD, and it is not hypothetical: card 071 is `MC-3 "Razor"
// Missile` with straight quotes and ZHAM-002 is `M60 “Boomerang” Missile` with
// curly ones, while the action text naming both uses straight. A literal
// pattern links Razor and silently misses Boomerang, which reads as broken.
check('quotes match loosely', /function quoteLoose/.test(ref), true);
check('covering both curly forms', /\["“”\]/.test(ref) && /\['‘’\]/.test(ref), true);
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.cards;
  // THE MERGE, and leaving it out is what made an earlier draft of this check
  // fail: cards 154 and 155 read `M7手雷` / `M9闪光弹` in cards.json and become
  // "M7 Grenade" / "M9 Stun Grenade" through name_overrides, which is what the
  // app actually links against.
  const nameOv = JSON.parse(readFileSync(new URL('../../data/name_overrides.json', import.meta.url), 'utf8')).cards ?? {};
  const nameOf = (c) => (nameOv[c.id]?.en ?? c.name?.en ?? '').trim();
  const named = list.filter((c) => c.category === 'projectile' || c.category === 'drone');
  check('there are projectiles and drones to link', named.length > 20, true);
  // The guard that keeps this from linking ordinary words: every real name is
  // long. If one ever ships shorter than the floor, this fails rather than the
  // reference quietly linking a common word mid-sentence.
  const CJK = /[぀-ヿ一-鿿]/;
  const short = named.map(nameOf).filter((n) => n && !CJK.test(n) && n.length < 8);
  check('and none is short enough to collide with prose', short, []);
  // Both quote styles really are in use, which is why quoteLoose exists.
  const all = named.map(nameOf).join(' ');
  check('the data really does mix quote styles', /"/.test(all) && /[“”]/.test(all), true);
  check('and the linker skips any name that is not English', /CJK\.test\(n\)/.test(ref), true);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
