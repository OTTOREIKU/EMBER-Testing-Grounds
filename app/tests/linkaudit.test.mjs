// The Reference's links, run for real over every text the site draws.
//
// The audit this pins (2026-09-30) found four ways a link went wrong, none of
// which a reader could tell from a working one until they clicked it:
//   - `Launch 1 MC-3 "Razor" Missile` linked only the word Missile. The text is
//     escaped before it is linked, the quotes had become `&quot;`, and the
//     quote-stripper only knew the characters;
//   - Parts, pilots and Tactics Cards named in the Rules linked nothing, since
//     only Projectiles and Drones were in the list;
//   - 25 glossary entries linked their own name, to themselves;
//   - ordinary words linked to keywords: "the hit Part", "designate 1 enemy".
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Reference links: the card, not the word in its name\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_linkaudit.entry.ts', import.meta.url);
const out = new URL('./_linkaudit.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { loadData } from '../src/data';\nexport * as R from '../src/refcards';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await M.loadData();
M.R.useCardData(data);

const A = /<a class="kw-link" data-(kw|card)="([^"]*)">([\s\S]*?)<\/a>/g;
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const links = (text, own) => [...M.R.linkKeywords(text, own).matchAll(A)]
  .map((m) => `${m[1]}:${unesc(m[2])}=${unesc(m[3].replace(/<[^>]+>/g, ''))}`);
const kwName = (k) => (k.en?.name ?? '').replace(/^[•·\s]+/, '');

// ---------- a quoted card name is the card ----------
check('a quoted missile name links the missile',
  links('Launch 1 MC-3 "Razor" Missile.'), ['card:071=MC-3 "Razor" Missile']);
check('the bare word is still the keyword',
  links('Launch 1 Missile.'), ['kw:Missile=Missile']);
check('a plural still names the card, and the s stays outside the link',
  links('Launch 1 GS-2 Smoke Grenades.'), ['card:268=GS-2 Smoke Grenade']);
check('so does a possessive',
  links("The HD-2 Data Backpack's +1 counts.")[0], 'card:500=HD-2 Data Backpack');

// ---------- every kind of card, not only what an Action launches ----------
check('a Part links', links('with the OCSP Overloading Pack fitted')[0], 'card:090=OCSP Overloading Pack');
check('a pilot links, by its longest name',
  links('Overload, Attack Mode and Hammerhead Domestic Expert add Ticks').filter((l) => l.startsWith('card:')),
  ['card:FPA-04-2=Hammerhead Domestic Expert']);
check('a Tactics Card links', links('play Additional Instructions now')[0], 'card:274=Additional Instructions');
check('but not the same words in a sentence', links('they hit and run for cover'), []);

// ---------- a capital makes the keyword ----------
check('"the hit Part" is prose', links('the hit Part is removed'), []);
check('"Hit" is the keyword', links('On a Hit, place a token').includes('kw:Hit=Hit'), true);
check('"designate 1 enemy" is prose', links('designate 1 enemy Unit').some((l) => l.startsWith('kw:Designate')), false);
check('a numbered keyword still links', links('This Action has Volley 2.'), ['kw:Volley X=Volley 2']);
check('a second printed name links to the same entry', links('· Indirect Fire'), ['kw:Indirect Fire=Indirect Fire']);

// ---------- the whole site ----------
let self = 0, lower = 0, half = 0;
const halves = [];
const norm = (s) => s.replace(/["“”‘’']/g, '').replace(/\s+/g, ' ').toLowerCase();
const cardNames = [];
for (const c of data.cards) {
  const n = norm(c.name?.en ?? '').trim();
  if (n.length >= 8 && !/[぀-ヿ一-鿿]/.test(n)) cardNames.push({ n, id: c.id });
}
const texts = [];
for (const k of data.keywords) if (k.en?.value) texts.push({ text: k.en.value, own: k, where: kwName(k) });
for (const m of data.mechanics) {
  for (const t of [m.basic, ...(m.points ?? []), m.text]) if (t) texts.push({ text: t, where: m.name });
}
for (const c of data.cards) {
  for (const t of [c.description?.en, ...(c.actions ?? []).map((a) => a.description?.en)]) if (t) texts.push({ text: t, where: c.id });
}
for (const t of texts) {
  const html = M.R.linkKeywords(t.text, t.own);
  const found = [...html.matchAll(A)];
  for (const m of found) {
    if (m[1] !== 'kw') continue;
    const def = data.keyword(unesc(m[2]));
    if (t.own && def === t.own) self++;
    const shown = m[3].replace(/<[^>]+>/g, '');
    if (def && /^[a-z]/.test(shown) && /^[A-Z]/.test(kwName(def))) lower++;
  }
  // A card named in full whose name is still partly plain text: the half-link.
  const plain = norm(unesc(html.replace(/<a class="kw-link"[^>]*>[\s\S]*?<\/a>/g, ' ▮ ').replace(/<[^>]+>/g, ' ')));
  const kwLinked = found.some((m) => m[1] === 'kw');
  for (const { n } of cardNames) {
    // The name, whole and capitalised in the source, yet split around a link.
    const words = n.split(' ');
    if (!kwLinked || words.length < 2) continue;
    const at = norm(t.text).indexOf(n);
    if (at < 0 || plain.includes(n)) continue;
    const linkedIds = found.filter((m) => m[1] === 'card').map((m) => m[2]);
    if (cardNames.some((c) => c.n.includes(n) && linkedIds.includes(c.id))) continue;
    half++; halves.push(`${t.where}: ${n}`);
  }
}
check('the pass read every text', texts.length > 800, true);
check('no glossary entry links its own name', self, 0);
check('no lower-case word links to a capitalised keyword', lower, 0);
check('no card name is linked by one word of it', halves, []);

// ---------- the entries say the rule ----------
const entry_ = (n) => data.keywords.find((k) => kwName(k) === n)?.en?.value ?? '';
check('no glossary text carries an empty glyph', data.keywords.filter((k) => /\{\s*\}/.test(k.en?.value ?? '')).map(kwName), []);
check('no card text carries one either',
  data.cards.filter((c) => (c.actions ?? []).some((a) => /\{\s*\}/.test(a.description?.en ?? '')) || /\{\s*\}/.test(c.description?.en ?? '')).map((c) => c.id), []);
for (const n of ['Non-humanoid X', 'Dense Armor', 'Tether X', 'Command Generation X', 'Cruising']) {
  check(`${n} states the rule, not where its wording came from`,
    /GoF 1\.0|rulebook appendix|Part Data|printed card read|took it off/.test(entry_(n)), false);
}
check('Dense Armor names the blank face', /blank face/.test(entry_('Dense Armor')), true);

// ---------- and the link opens the card ----------
// A keyword tile is itself clickable, and it answered first: a card named
// inside one opened the keyword. The card link is asked before the tile.
const refSrc = readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8');
const linkAt = refSrc.indexOf("closest<HTMLElement>('a.kw-link[data-card]')");
check('a card link is answered before the keyword tile it sits in',
  linkAt > 0 && linkAt < refSrc.indexOf("closest<HTMLElement>('[data-kwitem]')"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
