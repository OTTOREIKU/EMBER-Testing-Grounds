// Pilot trait text, against the publisher's own English.
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
import { readFileSync } from 'node:fs';

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
check('every trait override has English and a source',
  Object.entries(traits).filter(([, v]) => !v?.en || !v?.source).map(([k]) => k), []);
// A trait override that matches the bundle exactly is dead weight — it means
// the bundle was fixed upstream and the entry can go.
check('no override merely restates the bundle',
  Object.keys(traits).filter((id) => (byId.get(id)?.traitDescription?.en ?? '').trim() === traits[id].en.trim()), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
