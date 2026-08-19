// Pilot trait text and pilot trait NAMES, against the publisher's own English.
//   A pilot's trait is the only rules text on the card, and the community
//   bundle's English for it is not always right — ZPA-36 shipped "1 Cmmand
//   Token" for months. The championship parts lists carry the publisher's own
//   wording, so the corrections live in `name_overrides.traits` and this file
//   pins what the sweep found, so a regenerated cards.json cannot quietly undo
//   them.
//
// The xlsx files are not in the repo (they are OTTO's copies of publisher
// material), so this does NOT re-read them — it pins the RESULT of the
// 2026-08-11 sweep: which cards needed an override, and what the text has to
// say. Re-run the sweep by hand when a new list revision lands.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// esbuild is vite's own bundler, already a dependency. inventory.ts imports
// without extensions and reaches data.ts, which reads `import.meta.env`, so
// plain node cannot load it — the bundle is how the real class gets driven.
import { build } from 'esbuild';

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const traits = JSON.parse(readFileSync(new URL('../../data/name_overrides.json', import.meta.url), 'utf8')).traits ?? {};

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Pilot traits against the publisher\'s English\n');

// What the app actually shows: the override where there is one, the bundle's
// own English otherwise. Every assertion below reads through this, because an
// override that stops being applied is the failure worth catching.
const shown = (id) => (traits[id]?.en ?? byId.get(id)?.traitDescription?.en ?? '').trim();

// ---------- the typo this file was opened for ----------

check('ZPA-36 no longer says "Cmmand"', /Cmmand/.test(shown('ZPA-36')), false);
check('and the bundle still does, so the override is what fixes it',
  /Cmmand/.test(byId.get('ZPA-36')?.traitDescription?.en ?? ''), true);
// The official text names WHO spends the token; ours named nobody.
check('ZPA-36 names the piloted Mech as the spender', /piloted Mech may spend/.test(shown('ZPA-36')), true);
// The sheet writes "Command Stage", which appears nowhere in the rulebook.
check('ZPA-36 keeps the rulebook\'s phase name', [/Command Phase/.test(shown('ZPA-36')), /Command Stage/.test(shown('ZPA-36'))], [true, false]);

check('LPA-19 gained the bullet and full stop every other trait has', shown('LPA-19'), '· Recover 1 Link at the end of each round.');

// ---------- the false positive, pinned so it is not "fixed" ----------
//
// Two pilots reach us named KeyHole, and a sweep keyed on NAME collapses them
// and reports a difference that is not there. They are separate cards with
// separate traits and both are already correct: the publisher lists them as
// FPA-06 "Amplify" and FPA-19 "Hidden" (we hold the second as FPA-06-2).
check('the two KeyHoles are distinct cards', [byId.has('FPA-06'), byId.has('FPA-06-2')], [true, true]);
check('FPA-06 is the Amplify one', /Range of Aura, Electronic Attack and Electronic Support/.test(shown('FPA-06')), true);
check('FPA-06-2 is the Hidden one', /gains Low Profile/.test(shown('FPA-06-2')), true);
check('and neither carries the other\'s trait',
  shown('FPA-06') !== shown('FPA-06-2'), true);

// ---------- the shape of the override file ----------

check('every trait override names a card that exists',
  Object.keys(traits).filter((id) => !byId.has(id)), []);
// `en` (the description) and `name` (the trait's name) are independently
// optional — 20 entries correct only the name and XPA-62 only the text — so
// what is required is a source plus at least one thing to say.
check('every trait override says something and cites a source',
  Object.entries(traits).filter(([, v]) => (!v?.en && !v?.name) || !v?.source).map(([k]) => k), []);
// A trait override that matches the bundle exactly is dead weight — it means
// the bundle was fixed upstream and the entry can go. Only entries that carry
// text can restate it; a name-only entry has no bundle counterpart at all,
// because cards.json holds no English trait name for anybody.
check('no override merely restates the bundle',
  Object.keys(traits).filter((id) => traits[id].en && (byId.get(id)?.traitDescription?.en ?? '').trim() === traits[id].en.trim()), []);

// ---------- the publisher's English trait NAMES ----------
//
// cards.json holds the trait name as the bare Chinese (挑衅, 调整, 追击) and
// nothing else, so every English surface that printed one printed Chinese. The
// same parts lists carry the official English in the pilot sheets' `Trait`
// column, and it rides in on the same override entries as the text.
//
// DRIVEN, not read: the merge itself is what the two traps live in, so the REAL
// loop out of data.ts is run over the REAL cards and the REAL overrides. A test
// that only compared the JSON against a list would pass against a merge that
// throws half of it away — which is exactly what trap 1 does.
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const mechList = JSON.parse(readFileSync(new URL('../../data/mechanics.json', import.meta.url), 'utf8')).mechanics ?? [];
// `for (const a of c.actions ?? []) {` occurs four times in data.ts, so the
// terminator is searched from the START of the cut rather than from 0 — a bare
// indexOf would end this slice 265 lines above where it begins.
const cutAt = (s, a, b, what) => {
  const i = s.indexOf(a);
  const j = i < 0 ? -1 : s.indexOf(b, i);
  if (i < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};
const refSrc = src('reference.ts');
const refCut = (a, b, what) => cutAt(refSrc, a, b, `${what} in reference.ts`);
const nameSlice = new URL('./_traitnames.slice.ts', import.meta.url);
writeFileSync(nameSlice, `
type Card = any; type MechanicDef = any;
export const mechanics: MechanicDef[] = ${JSON.stringify(mechList)};
// loadData's card loop, reduced to the trait half. Everything else in that loop
// (qrId, card names, action names) is another file's business.
export function mergeTraits(cards: Card[], names: any): void {
  for (const c of cards) {
${cutAt(dataSrc, '    const tn = names.traits?.[c.id];', '    for (const a of c.actions ?? []) {', 'the trait override merge in data.ts')}  }
}
` + cutAt(dataSrc, 'export function traitName(', 'function cleanName(', 'traitName in data.ts')
  // mechanicsFor is a closure over `mechanics`, which is declared above — so the
  // matcher under test is the shipped one, patterns and all.
  + 'export' + cutAt(dataSrc, '  const mechanicsFor = (...text:', '  const translations = xlate.translations', 'mechanicsFor in data.ts')
  // ---------- the reference GRID TILE, sliced so it can be DRIVEN ----------
  //
  // reference.ts calls init() at module scope, so the page cannot be imported
  // and cardRow is not exported anyway. The real function is cut out and run
  // instead, exactly as this file already runs data.ts's merge loop. It closes
  // over `traitName`, which is declared above from data.ts, so the tile prints
  // through the shipped helper and not through a copy of it.
  //
  // Three cuts from reference.ts, checked against each other and against the
  // three data.ts cuts above (which are in a different file, so they cannot
  // collide): SLOT_LABEL..CATEGORY_LABEL, SPEED_MARK..norm — that one carries
  // `esc`, which cardRow and pointsChip both need — and kwLabel..cardDetail,
  // which carries pointsChip and cardRow together. Nothing in the three
  // declares `data`, `mechanics` or `traitName`, so the stubs below and the
  // data.ts cuts above stand.
  + `
const data: any = {
  // Only what cardRow and kwLabel reach for. The tile's faction stripe and its
  // keyword labels are other files' rules; the trait name is this one's.
  keyword: (_k: string) => undefined,
  factionOf: (c: Card) => c.faction,
};
const actionIconUrl = (_t: string | undefined) => null;
const zeroCostReason = (_c: Card) => '';
const cardName = (c: Card) => c.name?.en || c.name?.zh || c.id;
export { cardRow };
`
  + refCut('const SLOT_LABEL: Record<string, string> = {', '// The detail header used to print', 'SLOT_LABEL')
  + refCut('const SPEED_MARK: Record<string,', 'const norm = ', 'SPEED_MARK and esc')
  + refCut('function kwLabel(', 'function cardDetail(', 'kwLabel, pointsChip and cardRow'));
const { mergeTraits, traitName, mechanicsFor, cardRow } = await import(nameSlice.href);

{
  const merged = JSON.parse(JSON.stringify(cards));
  const bundleEn = new Map(merged.map((c) => [String(c.id), (c.traitDescription?.en ?? '')]));
  mergeTraits(merged, { traits });
  const after = new Map(merged.map((c) => [String(c.id), c]));
  const named = merged.filter((c) => (c.trait ?? '').trim());

  check('all 23 trait-bearing pilots are still trait-bearing', named.length, 23);
  check('LPA-22 Yoyu shows the publisher\'s English trait name', traitName(after.get('LPA-22')), 'Provoke');
  check('and ZPA-36 and LPA-24 do too', [traitName(after.get('ZPA-36')), traitName(after.get('LPA-24'))], ['Adjustment', 'Chase']);
  // Never blank is the rule, and XPA-62 is why it is a rule rather than a
  // formality: Seagull is in none of the five parts lists, so it has no English
  // name to show and falls back to its own Chinese.
  check('no trait-bearing pilot shows a blank name', named.filter((c) => !traitName(c)).map((c) => c.id), []);
  check('XPA-62 falls back to the Chinese, because the publisher never named it',
    [traitName(after.get('XPA-62')), !!traits['XPA-62'].name], ['高抛发射', false]);
  check('so 22 of the 23 read as English', named.filter((c) => !/^[\x20-\x7e]+$/.test(traitName(c))).map((c) => c.id), ['XPA-62']);

  // ---------- TRAP 1: a name-only entry must not blank the description ----------
  //
  // The merge used to do `c.traitDescription = { ...c.traitDescription, en: tn.en }`
  // for ANY entry present. Add an override that carries only a name and `tn.en`
  // is undefined, so the spread writes `en: undefined` and that pilot's English
  // rules text disappears — on every page at once, silently.
  const nameOnly = Object.keys(traits).filter((id) => traits[id].name && !traits[id].en);
  check('20 of the 22 overrides correct the name and nothing else', nameOnly.length, 20);
  check('and not one of them changed its English description',
    nameOnly.filter((id) => (after.get(id)?.traitDescription?.en ?? '') !== bundleEn.get(id)), []);
  check('which is real text on both sides, so the comparison above can bite',
    nameOnly.filter((id) => !(bundleEn.get(id) ?? '').trim()), []);
  // The other direction: an entry carrying BOTH still applies both.
  check('an entry with a name AND text applies both',
    [traitName(after.get('ZPA-36')), /Cmmand/.test(after.get('ZPA-36').traitDescription.en)],
    ['Adjustment', false]);
  check('and a text-only entry still corrects the text and adds no name',
    [after.get('XPA-62').traitDescription.en.trim(), after.get('XPA-62').traitNameEn],
    ['· This unit’s Projectile action Range +2.', undefined]);

  // ---------- TRAP 2: the mechanics matcher still gets the Chinese ----------
  //
  // mechanicsFor is a substring test over patterns that are Chinese for every
  // rule a trait can name, and the trait NAME is handed to it beside the trait
  // text. LPA-21 Firefly is the card that proves the English is not a drop-in:
  // its publisher name is "Stealth", which is Manifestation Movement's own match
  // pattern — a rule Firefly's trait never mentions.
  const ids = (...t) => mechanicsFor(...t).map((m) => m.id);
  const firefly = after.get('LPA-21');
  check('fed the Chinese, LPA-21 gets Optical Camouflage and nothing else',
    ids(firefly.traitDescription.en, firefly.trait), ['optical_camouflage']);
  check('fed the English name instead, it gains a rule the card never mentions',
    ids(firefly.traitDescription.en, traitName(firefly)), ['optical_camouflage', 'manifestation_movement']);
  // And the reverse risk, measured across the whole set rather than argued: no
  // Chinese trait name matches anything on its own, so the argument is only ever
  // costing us matches if a later mechanics entry adds a Chinese trait name.
  check('no Chinese trait name matches a mechanic by itself',
    named.filter((c) => ids(c.trait).length).map((c) => c.id), []);

  // THE WIRING, because a reader test is not a wiring test and this codebase has
  // shipped that gap five times. Each surface has to print through traitName()
  // and keep handing the matcher the Chinese.
  //
  // WHAT USED TO STAND HERE, and why it is gone: one `/\btraitName\(/` test per
  // file. It was the same mistake in a different hat — a regex over source is
  // not a wiring test either. Two surfaces were measured unwiring underneath it
  // with the whole suite still exit 0:
  //   * inventory.ts satisfied it from a COMMENT ("traitName() supplies it"),
  //     so setting its `traitName:` field to undefined changed nothing here.
  //   * reference.ts satisfied it from the DETAIL view a hundred lines below,
  //     so reverting the grid tile to '· has a trait ability' changed nothing.
  // Both are driven for real below. partpicker.ts and squads.ts were caught by
  // that regex only by luck — one call each, and no comment naming it — so they
  // get the precise, single-call pin panel.ts already had rather than a test
  // any mention of the word would satisfy.
  check('the part picker prints the publisher\'s name above the rule',
    /const traitLabel = named \? traitName\(card\) : '';/.test(src('partpicker.ts')), true);
  check('and the squad tracker\'s pilot hover names the trait rather than counting it',
    /card\.trait \? `Trait: \$\{traitName\(card\)\}\.` : ''/.test(src('squads.ts')), true);
  check('panel.ts prints the English and matches on the Chinese',
    /Pilot Trait <i>\$\{traitName\(card\)\}<\/i>/.test(src('panel.ts'))
      && /mechanicsFor\(traitDesc, card\.trait\)/.test(src('panel.ts')), true);
  check('reference.ts keeps the display name and the matcher key apart',
    /const traitShown = traitZh \? esc\(traitName\(c\)\) : '';/.test(src('reference.ts'))
      && /mechBlocks\(traitText, c\.traitDescription\?\.zh, traitZh\)/.test(src('reference.ts')), true);
  // No page may reach past the helper to the raw Chinese field for DISPLAY.
  // `card.trait` survives only as the matcher argument and as the has-a-trait
  // test, so what is banned is interpolating it into markup.
  check('and nobody interpolates the raw Chinese name into markup',
    ['panel.ts', 'reference.ts', 'inventory.ts', 'partpicker.ts', 'squads.ts']
      .filter((f) => /\$\{(esc\()?(c|card|i)\.trait\)?\}/.test(src(f))), []);

  // ---------- DRIVEN: the reference GRID TILE ----------
  //
  // The tile a player scans a whole faction's pilots in. It used to say
  // "· has a trait ability" for all 23 of them, which told a reader nothing
  // about the one thing a pilot is picked for. The REAL cardRow is run over the
  // REAL merged card, and the English is read out of the markup it returned.
  const yoyuTile = cardRow(after.get('LPA-22'));
  check('the reference grid tile names Yoyu\'s trait', /<div class="card-body">[^<]*· Provoke<\/div>/.test(yoyuTile), true);
  check('and does not fall back to the placeholder it used to print',
    /has a trait ability/.test(yoyuTile), false);
  // The faction still leads the line, so the name was ADDED to the tile rather
  // than printed instead of what was there.
  check('with the faction still ahead of it',
    /<div class="card-body">UN · Provoke<\/div>/.test(yoyuTile), true);
  // XPA-62 has no publisher English, so the tile shows its Chinese rather than
  // going blank — the same fallback traitName() gives every other surface.
  check('a pilot the publisher never named still shows something',
    /<div class="card-body">[^<]*· 高抛发射<\/div>/.test(cardRow(after.get('XPA-62'))), true);
  // The control: a card with no trait prints no separator at all, so the
  // assertions above are reading a line that only a trait puts there.
  check('and a card with no trait adds nothing to the tile',
    / · /.test(cardRow({ ...after.get('LPA-22'), trait: '' })), false);

  // ---------- DRIVEN: the inventory box-compare list ----------
  //
  // Two boxes side by side, and pilots are compared by their traits — which is
  // why the NAME leads the line there. The real Inventory is bundled and run
  // against a DOM stub, and the assertion reads the markup it wrote, so the
  // `traitName:` field and the `<b>` that prints it are both covered. esbuild
  // is vite's own bundler and is already here; if it ever goes away this throws
  // loudly rather than skipping, because a silent skip would restore exactly
  // the blind spot this replaced.
  const bundle = new URL('./_traitwiring.bundle.mjs', import.meta.url);
  await build({
    stdin: {
      contents: "export { Inventory } from './src/inventory';",
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      loader: 'ts',
    },
    outfile: fileURLToPath(bundle),
    bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
    // vite supplies this at build time; nothing here loads an asset anyway.
    define: { 'import.meta.env.BASE_URL': '"/"' },
  });
  const { Inventory } = await import(`${bundle.href}?t=${Date.now()}`);

  // Only what showCompare touches. querySelector hands back a memoised stub so
  // the `!` assertions in the source find something to bind a listener to, and
  // innerHTML stays the plain string the code wrote — which is the thing being
  // read. The constructor's localStorage read is already inside a try/catch, so
  // its absence here is the no-inventory case rather than a crash.
  const stubEl = (tag = 'div') => {
    const e = {
      tagName: String(tag).toUpperCase(), className: '', id: '', innerHTML: '', dataset: {}, children: [], _q: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { e.children.push(c); return c; },
      insertBefore(c) { e.children.unshift(c); return c; },
      remove() {},
      addEventListener() {},
      querySelector(sel) { return (e._q[sel] ??= stubEl('div')); },
      querySelectorAll() { return []; },
    };
    return e;
  };
  globalThis.document = { createElement: (t) => stubEl(t), getElementById: () => null };

  // Box membership is fixture, not rule: WHICH box a pilot ships in is
  // box_contents_overrides' business and another file's test. What is driven
  // here is what the row says once the pilot is in the list.
  const boxes = [
    { key: 'BOX-A', id: 901, name: { en: 'Box A' }, released: true },
    { key: 'BOX-B', id: 902, name: { en: 'Box B' }, released: true },
  ];
  const invCards = [after.get('LPA-22'), after.get('XPA-62')].map((c) => ({
    ...c, containedIn: [{ box: 'BOX-A', quantityPerBox: 1 }],
  }));
  const inv = new Inventory(boxes, () => {}, invCards);
  const dlg = stubEl('div');
  inv.showCompare(dlg);
  const compareHtml = dlg.children.map((x) => x.innerHTML).join('');
  check('the compare list leads a pilot row with the publisher\'s trait name',
    /<b>Provoke<\/b>/.test(compareHtml), true);
  check('and still prints the rule after it',
    /<b>Provoke<\/b>\s*[^<]*Electronic Counter Roll/.test(compareHtml), true);
  check('the unnamed pilot keeps its Chinese there too',
    /<b>高抛发射<\/b>/.test(compareHtml), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
