// Every English field must actually hold English.
//
// cards.json is REGENERATED from the community bundle, which routinely puts the
// Chinese text in the `en` field. The override files are how that is corrected,
// so this test asserts the corrected result rather than the raw file -- reading
// cards.json alone reports defects that the loader has already fixed, and hides
// the ones the loader introduces.
//
// The reference has always guarded the DISPLAY (englishOnly in reference.ts
// suppresses any `en` string containing CJK), so a regression here is invisible
// on screen: the line silently disappears instead of showing Chinese. That is
// exactly why it needs a test and not an eyeball.
//
// The Chinese is deliberately KEPT alongside. Several readers in units.ts match
// on the zh (the printed-keyword routes), and mechBlocks is fed it separately,
// so a "fix" that dropped it would break rules wiring. Pinned below.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('English fields hold English\n');

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const raw = json('../../data/cards.json');
const cards = Array.isArray(raw) ? raw : raw.cards;
const names = json('../../data/name_overrides.json');
const actFix = json('../../data/action_overrides.json').actions ?? {};
const statFix = json('../../data/stat_overrides.json').cards ?? {};
const xlate = json('../../data/action_translations.json').translations ?? {};

// The same CJK class reference.ts uses to decide a string is not English.
const CJK = /[぀-ヿ一-鿿]/;

// ---------- apply the override layers, as data.ts does ----------
for (const c of cards) {
  const cn = names.cards?.[c.id];
  if (cn?.en) c.name = { ...c.name, en: cn.en };
  const sf = statFix[c.id];
  if (sf?.name) c.name = { ...c.name, ...sf.name };
  if (sf?.description) c.description = { ...c.description, ...sf.description };
  for (const a of c.actions ?? []) {
    const an = names.actions?.[a.id];
    if (an?.en) a.name = { ...a.name, en: an.en };
    const af = actFix[a.id];
    if (af?.name) a.name = { ...a.name, ...af.name };
    if (af?.description) a.description = { ...a.description, ...af.description };
  }
}

// Guard the reader: every assertion below is vacuously true against no data.
check('the cards were actually read', cards.length > 200, true);
const actionCount = cards.reduce((n, c) => n + (c.actions ?? []).length, 0);
check('and their actions', actionCount > 300, true);

// ---------- nothing English-labelled may hold Chinese ----------
const cardNames = cards.filter((c) => CJK.test(c.name?.en ?? '')).map((c) => c.id);
check('no card name', cardNames, []);

const actNames = cards.flatMap((c) => (c.actions ?? []).filter((a) => CJK.test(a.name?.en ?? '')).map((a) => a.id));
check('no action name', actNames, []);

const cardDesc = cards.filter((c) => CJK.test(c.description?.en ?? '')).map((c) => c.id);
check('no card description', cardDesc, []);

const actDesc = cards.flatMap((c) => (c.actions ?? []).filter((a) => CJK.test(a.description?.en ?? '')).map((a) => a.id));
check('no action description', actDesc, []);

const traitDesc = cards.filter((c) => CJK.test(c.traitDescription?.en ?? '')).map((c) => c.id);
check('no trait description', traitDesc, []);

// ---------- and nothing is left with no English at all ----------
// An Action carrying Chinese rules text must have English somewhere a reader
// can reach: its own description, or our translation file (which the reference
// prints with a "translated from the Chinese card text" note).
const stranded = [];
for (const c of cards) {
  for (const a of c.actions ?? []) {
    const zh = (a.description?.zh ?? '').trim();
    const en = (a.description?.en ?? '').trim();
    if (!zh || en) continue;
    if (!((xlate[a.id]?.english ?? '').trim())) stranded.push(a.id);
  }
}
check('every Action with Chinese rules text has English somewhere', stranded, []);

// ---------- the Chinese is still there ----------
// The rules wiring depends on it. A future pass that "cleans up" by deleting
// the zh would take the printed-keyword routes in units.ts down with it.
// Counts as they stand: 44 cards and 408 actions carry Chinese rules text.
// Floors rather than exact numbers, so adding a card does not fail this, but
// a pass that strips the zh does.
//
// FIVE deliberate clearings, every one because the bundle's Chinese is a
// SUPERSEDED printing whose current Chinese we do not hold, and inventing it
// would put made-up text where a reader expects the printed card:
//   - action 180_B and card 180 (the PL29 redesign; the old zh held 静默 and
//     was still read as a Silence Action)
//   - actions ZHDR-102_A and ZHDR-103_A (the 1.021 Vanguard regunning; 102's
//     old zh held 拦截1 and was still read as Interception capacity)
//   - action ZHDR-304_B (the Harpy tow; the old zh carried no Movement cost)
// Lowering either floor again should mean finding the same kind of reason.
const keptZh = cards.filter((c) => (c.description?.zh ?? '').trim()).length;
check('card Chinese text is preserved, not deleted', keptZh >= 44, true);
const keptActZh = cards.reduce((n, c) => n + (c.actions ?? []).filter((a) => (a.description?.zh ?? '').trim()).length, 0);
check('and action Chinese text too', keptActZh >= 408, true);

// The Silence bug itself, pinned: the redesigned Jump must not read as Silent.
const jump = cards.find((c) => c.id === '180')?.actions?.find((a) => a.id === '180_B');
check('the PL29 Jump no longer carries the superseded Silence text',
  /静默/.test(jump?.description?.zh ?? '') || /Silence/i.test(jump?.description?.en ?? ''), false);

// The five UN munitions and four cores this was built for, named so a
// regeneration that loses their override is reported as those cards.
for (const id of ['154', '155', '156', '157', '158']) {
  const a = cards.find((c) => c.id === id)?.actions?.[0];
  check(`card ${id}'s action reads in English`, CJK.test(a?.description?.en ?? ''), false);
}
for (const id of ['093', '095', '539', '545']) {
  const c = cards.find((x) => x.id === id);
  check(`card ${id}'s body text reads in English`, CJK.test(c?.description?.en ?? ''), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
