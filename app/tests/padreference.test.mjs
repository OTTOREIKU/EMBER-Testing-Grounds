// The pad's Find and detail sheet take the Reference's own renderers and
// behaviours (OTTO, 2026-09-30): "the new reference keywords/rule styles arent
// populating the PAD", "the button/section UI design does not match reference
// either", and "Rather than rebuild that section we should try to import the
// look and style of the reference app into pad so future updates will appear".
// The Rules tab lives in refcards.ts, the sheet's behaviours in refsheet.ts,
// the tab strip in reference.css's .ref-tabs; both pages draw from them.
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

console.log('The pad shows the Reference\'s own Rules and sheets\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_padreference.entry.ts', import.meta.url);
const out = new URL('./_padreference.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export * as R from '../src/refcards';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const U = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await U.loadData();
U.R.useCardData(data);
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------- the Rules tab, drawn once ----------
const tab = U.R.rulesTab('');
check('the tab opens on its filter row: All, then Season, then the main sections',
  [...tab.matchAll(/data-rules="([^"]*)"/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i),
  ['', 'season', 'cards', 'phases', 'timings', 'stances', 'dice', 'tokens', 'mechanics']);
check('with the master changelog\'s way in, and none under a search or a chosen section',
  [/data-clv="1\.04"/.test(tab), /data-clv=/.test(U.R.rulesTab('smoke')), /data-clv=/.test(U.R.rulesTab('', 'mechanics')), /data-clv=/.test(U.R.rulesTab('', undefined, { entries: false }))],
  [true, false, false, false]);
const camo = (U.R.rulesTab('', 'mechanics').match(/<article class="card">\s*<div class="card-title">Optical Camouflage<\/div>[\s\S]*?<\/article>/) ?? [''])[0];
check('Optical Camouflage is the two-layer entry: the short view first, the full text behind Advanced',
  [/<p class="mech-basic">/.test(camo), /<details class="mech-adv">/.test(camo), camo.indexOf('mech-basic') < camo.indexOf('mech-adv')],
  [true, true, true]);
check('a chosen section shows alone', [...U.R.rulesTab('', 'season').matchAll(/<p class="ref-count[^"]*">([^<]+)<\/p>/g)].map((m) => m[1]), ['Season Rules']);
const secs = U.R.rulesSections('camouflage');
const mech = secs.find((x) => x.id === 'mechanics');
check('each section lists its tiles for a page that shows them one by one',
  [mech.tiles.length > 0, mech.tiles.every((t) => t.startsWith('<article') && t.endsWith('</article>')), /Optical Camouflage/.test(mech.tiles[0])],
  [true, true, true]);

// ---------- the sheets both pages open ----------
check('card, keyword, changelog, Rules entry and Season Rule sheets come from one place',
  [['card', data.cards[0].id], ['keyword', data.keywords[0].key], ['changelog', '1.04'], ['rule', 'optical_camouflage'], ['season', data.seasons[0].rules[0].id], ['box', 'x']]
    .map(([k, key]) => U.R.sheetHtml(k, key) !== null),
  [true, true, true, true, true, false]);
check('and name themselves for the Back button the same way',
  [U.R.sheetLabel('changelog', '1.04'), U.R.sheetLabel('rule', 'optical_camouflage')], ['What changed in 1.04', 'Optical Camouflage']);

// ---------- the pad draws from them ----------
const pad = src('../pad/pad.ts');
check('the pad imports the Rules tab and the sheets, and its sheet behaviours',
  [/rulesSections, rulesTab, sheetHtml as refSheetHtml, sheetLabel as refSheetLabel/.test(pad),
    /import \{ applyChangelogFilter, decorateSheetHead, holdDetailHeight, revealLog, runSheetClick, runSheetFocus, runSheetInput, runSheetKey, showDetailTab, type SheetKind, type SheetNav \} from '\.\.\/src\/refsheet';/.test(pad)],
  [true, true]);
check('its Rules scope IS the Reference\'s tab, and it keeps no Rules tiles of its own',
  [/if \(find\.scope === 'rules'\) return rulesTab\(q, find\.rules\);/.test(pad), /linkKeywords\(m\.text\)/.test(pad), /tile\(`\$\{x\.name\} timing`/.test(pad)],
  [true, false, false]);
check('its scopes are the Reference\'s tab strip',
  [/<div class="ref-tabs pad-find-scopes" id="pad-find-scopes"><\/div>/.test(pad), /data-act="find-scope" data-scope="\$\{s\.id\}">\$\{esc\(s\.label\)\}\$\{\s*live \? `<span class="tab-n">/.test(pad)],
  [true, true]);
check('its sheet answers the Reference\'s links and keys, heads the sheet and filters the changelog as the Reference does',
  [/if \(runSheetClick\(ev, padNav\)\) return;/.test(pad), /if \(runSheetKey\(ev\)\) return;/.test(pad),
    /decorateSheetHead\(content\);/.test(pad), /if \(content\.querySelector\('\.cl-list'\)\) applyChangelogFilter\(content\);/.test(pad),
    /document\.addEventListener\('input', runSheetInput\);/.test(pad)],
  [true, true, true, true, true]);

// No pad control may carry an attribute the shared router reads as a LINK: it
// is asked before the pad's own buttons, so the button's tap never arrives. The
// Rules row's Season chip carried `data-season` and could not be pressed at all.
const ROUTER = /data-(?:season|rulesheet|clv|clkind|clver|logcard|logkw|logrule|logseason|dtab)="/;
const padFiles = ['../pad/pad.ts', '../pad/guided.ts', '../pad/attack.ts', '../pad/tabledice.ts', '../pad/ew.ts'].map(src);
const clashes = padFiles.flatMap((text) => [...text.matchAll(/data-act="[^"]*"[^>]{0,400}?>/g)].map((m) => m[0]).filter((tag) => ROUTER.test(tag)));
check('no pad button wears an attribute the shared router takes for a link', clashes, []);
check('the Season chip names its season in its own attribute', /data-act="set-season" data-pickseason="/.test(pad), true);

// ---------- and so does the Reference ----------
const ref = src('../src/reference.ts');
check('the Reference draws its tab and sheets from the same place',
  [/el\.innerHTML = rulesTab\(q, rulesSection\);/.test(ref), /return sheetHtml\(v\.kind, v\.key\);/.test(ref), /if \(runSheetClick\(ev, sheetNav\)\) return;/.test(ref)],
  [true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
