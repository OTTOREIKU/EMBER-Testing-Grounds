// The Changelog on a card (OTTO, 2026-09-30): what the publisher's list
// revisions changed since the card was printed, closed under the stat strip.
//
// data/changelog.json is generated from the list diffs, and the card above it
// is drawn from the override files. The two are separate files written by
// separate steps, so this pins them to each other: every number the changelog
// ends on is the number the card shows, every Action it names is on the card,
// and every 1.04 price in stat_overrides has its line in the changelog.
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

console.log('Changelog: the card and its history agree\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_changelog.entry.ts', import.meta.url);
const out = new URL('./_changelog.bundle.mjs', import.meta.url);
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
const log = data.changelog;
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// ---------- the file arrived ----------
check('the changelog loads', Object.keys(log.cards).length > 50, true);
check('its revisions are named, oldest first', log.versions.map((v) => v.id), ['1.02', '1.021', '1.04']);

// ---------- every card and Action it names is real ----------
const missingCards = Object.keys(log.cards).filter((id) => !data.byId.get(id));
check('every card it names exists', missingCards, []);
const missingActions = [];
for (const [id, es] of Object.entries(log.cards)) {
  const c = data.byId.get(id);
  for (const e of es) if (e.action && !(c?.actions ?? []).some((a) => a.id === e.action)) missingActions.push(`${id}:${e.action}`);
}
check('every Action it names is on its card', missingActions, []);
const unknownV = Object.values(log.cards).flat().filter((e) => !log.versions.some((v) => v.id === e.v));
check('every entry names a known revision', unknownV.length, 0);

// ---------- the last value of every field is the one the card shows ----------
const STATS = ['score', 'armor', 'structure', 'parray', 'dodge', 'electronic', 'move'];
const dice = (a) => [['Y', a.yellowDice], ['R', a.redDice], ['W', a.whiteDice], ['B', a.blueDice]]
  .filter(([, n]) => n).map(([k, n]) => `${n}${k}`).join('');
const off = [];
for (const [id, es] of Object.entries(log.cards)) {
  const c = data.byId.get(id);
  if (!c) continue;
  const last = new Map();
  for (const e of es) if (e.field && e.field !== 'text' && e.field !== 'trait') last.set(`${e.action ?? ''}|${e.field}`, e);
  for (const [k, e] of last) {
    const [aid, field] = k.split('|');
    if (!aid) {
      if (STATS.includes(field) && (c[field] ?? 0) !== (e.to ?? 0)) off.push(`${id} ${field}: card ${c[field]}, log ${e.to}`);
      continue;
    }
    const a = (c.actions ?? []).find((x) => x.id === aid);
    if (!a) continue;
    if (field === 'range' && String(a.range) !== String(e.to)) off.push(`${aid} range: card ${a.range}, log ${e.to}`);
    if (field === 'dice' && dice(a) !== String(e.to).toUpperCase()) off.push(`${aid} dice: card ${dice(a)}, log ${e.to}`);
    if (field === 'length' && (a.size ?? '').toUpperCase() !== String(e.to ?? '').toUpperCase()) off.push(`${aid} length: card ${a.size}, log ${e.to}`);
  }
}
check('every number the changelog ends on is the number the card shows', off, []);

// ---------- the 1.04 prices and their lines ----------
// stat_overrides marks a 1.04 price with its source; the changelog must have
// the same move, from and to, for each of them and for nothing else.
const stat = json('../../data/stat_overrides.json').cards;
const priced = Object.entries(stat)
  .filter(([, v]) => /parts list 1\.04 \(was \d+/.test(v._source ?? '') && typeof v.score === 'number')
  .map(([id, v]) => `${id}:${/was (\d+)/.exec(v._source)[1]}>${v.score}`).sort();
const logged = Object.entries(log.cards)
  .flatMap(([id, es]) => es.filter((e) => e.v === '1.04' && e.field === 'score').map((e) => `${id}:${e.from}>${e.to}`)).sort();
check('every 1.04 price has its changelog line, and no line lacks its price', logged, priced);
check('1.04: the PD, RDL and UN lists (8 + 31 + 31 prices)', priced.length, 70);
check('a PD Drone costs its 1.04 price', data.byId.get('PRDR-101').score, 84);
check('the Avalanche costs its 1.04 price', data.byId.get('503').score, 51);
check('the RT-15B Lava costs its 1.04 price', data.byId.get('017').score, 59);
// OTTO, 2026-09-30: a card a list stops carrying may only be out of production,
// so it stays as it is, unflagged, until a later list says more.
check('a card a list drops gets no line', ['280', '286', 'ZYBP-201', 'ZHLA-102-T'].map((id) => log.cards[id] ?? null), [null, null, null, null]);
check('the two pilots the UN list adds say they are new',
  ['LPA-OPAL', 'LPA-TOURMALINE'].map((id) => log.cards[id]?.map((e) => `${e.v} ${e.kind} ${e.list}`)), [['1.04 added UN'], ['1.04 added UN']]);

// ---------- what the sheet draws ----------
const html = M.R.changelogBlock(data.byId.get('180'));
check('a changed card gets the section', /<details class="ref-log">/.test(html), true);
check('and it starts closed', /<details class="ref-log" open/.test(html), false);
check('the summary names the newest revision', /Changed in GoF 1\.021/.test(html), true);
check('the count is the number of changes', /<span class="ui-badge">9<\/span>/.test(html), true);
check('one Action is one block, not a row per change', (html.match(/<div class="ui-row-name">Jump/g) ?? []).length, 1);
check('dice are drawn as the card draws them', /glyph-die/.test(M.R.changelogBlock(data.byId.get('ZHRA-202'))), true);
check('a card with no history gets nothing', M.R.changelogBlock(data.byId.get('001')), '');
check('the card detail carries it under the stat strip',
  /class="ref-stats"[\s\S]*?<details class="ref-log">[\s\S]*?Actions/.test(M.R.cardDetail(data.byId.get('180'))), true);
const opal = M.R.changelogBlock(data.byId.get('LPA-OPAL'));
check('a new card reads "New in 1.04" and names its list', [/New in 1\.04/.test(opal), /New on the UN parts list/.test(opal)], [true, true]);
check('and has no "printed values" footnote, having no printing', /ref-log-foot/.test(opal), false);
check('the footnote points at the stats, not the card image',
  /The stats above show the current values/.test(M.R.changelogBlock(data.byId.get('180'))), true);

// ---------- the Rules entries (OTTO: at the top of Advanced) ----------
const ruleIds = Object.keys(log.rules ?? {});
check('every Rules changelog names a real Rules entry',
  ruleIds.filter((id) => !data.mechanics.some((m) => m.id === id)), []);
check('each line says where it comes from', Object.values(log.rules).flat().every((e) => e.v && e.source && e.text), true);
const minesEntry = data.mechanics.find((m) => m.id === 'mines');
const minesHtml = M.R.mechanicBody(minesEntry);
check('the changelog is the FIRST thing inside Advanced',
  /<div class="mech-adv-b"><div class="mech-log">/.test(minesHtml), true);
check('and the closed Advanced says there is a change inside', /<summary>Advanced <span class="mech-adv-new">Updated 1\.04<\/span><\/summary>/.test(minesHtml), true);
check('an entry with no changes has neither',
  (() => { const h = M.R.mechanicBody(data.mechanics.find((m) => m.id === 'crush')); return /mech-log|mech-adv-new/.test(h); })(), false);
// ---------- the glossary (keyword sheets) ----------
const kwIds = Object.keys(log.keywords ?? {});
check('every glossary changelog names a real keyword', kwIds.filter((k) => !data.keywords.some((x) => x.key === k)), []);
check('and each of its lines says where it comes from', Object.values(log.keywords ?? {}).flat().every((e) => e.v && e.source && e.text), true);
check('and names a known revision', Object.values(log.keywords ?? {}).flat().filter((e) => !log.versions.some((v) => v.id === e.v)).length, 0);
check('the Mines entry\'s short view says the rule as it now stands (M22)',
  [/every ground unit there/.test(minesEntry.basic), (minesEntry.points ?? []).some((p) => /not the flying or Aerial units/.test(p))], [true, true]);

// ---------- the rows (OTTO, 2026-09-30, Chips A): the chip over the text ----------
// The revision's chip sits on its own line, the sentence runs under it at full
// width, and where the change comes from goes last, so the text of every row
// starts at one edge. A card's revision opens on the same chip, its list under
// its rows.
const TAGS = ['NEW', 'NAME', 'CHANGED', 'CLARIFIED', 'REVERSED', 'RETIRED', 'OPTIONAL'];
const lines = [...Object.values(log.rules), ...Object.values(log.keywords)].flat();
check('every Rules and glossary line carries known tags',
  lines.filter((e) => !e.tags?.length || e.tags.some((t) => !TAGS.includes(t))).map((e) => e.text.slice(0, 40)), []);
check('every revision says what its card rows rest on', log.versions.filter((v) => !v.source).map((v) => v.id), []);
check('a Rules row is the chip, the sentence, then its source',
  /<li><span class="log-ver">1\.04<\/span><div class="log-say">[\s\S]*?<\/div><div class="log-src">Supplementary Rules 1\.04, 1\.3<\/div><\/li>/.test(minesHtml), true);
check('a card revision opens on the same chip, its list named under its rows',
  [/<div class="log-rev"><span class="log-ver">1\.04<\/span><\/div><ul class="ui-list ref-log-list">[\s\S]*?<\/ul><p class="log-src log-rev-src">PD parts list 1\.04<\/p>/.test(M.R.changelogBlock(data.byId.get('PRDR-101'))),
    /<p class="log-src log-rev-src">GoF parts list 1\.021<\/p>/.test(M.R.changelogBlock(data.byId.get('180')))], [true, true]);
const css = readFileSync(new URL('../src/reference.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
check('a row list inside a Rules card fills the card: the list indent is gone',
  [/\.card-body ul\.ui-list \{ padding-left: 0;/.test(css), /\.ui-list\.mech-log-list > li \{\n\s*flex-direction: column;/.test(css)], [true, true]);

// ---------- the master changelog (OTTO, 2026-09-30) ----------
const groups = M.R.changelogGroups('1.04');
const count = (t) => groups.filter((g) => g.title === t).reduce((s, g) => s + g.items.length, 0);
// 9 rules: the Smoke Screens line left for the Season Rules (OTTO, 2026-09-30),
// which are their own kind and lead the list ("move the seasonal button and
// items to the front"); the Pholcus and the White Dwarf joined with OTTO's
// answers on 1.9 and 3.3 the same day.
check('1.04 lists 2 Season Rules, 9 rules, 11 keywords and 74 cards',
  [count('Season'), count('Rules'), count('Keywords'), count('Cards')], [2, 9, 11, 74]);
check('in that order', [...new Set(groups.map((g) => g.title))], ['Season', 'Rules', 'Keywords', 'Cards']);
check('its cards come faction by faction, in the record\'s order',
  groups.filter((g) => g.title === 'Cards').map((g) => `${g.fac}:${g.items.length}`), ['PD:8', 'RDL:31', 'UN:35']);
const targets = groups.flatMap((g) => g.items.map((i) => i.attr));
const lost = targets.filter((a) => {
  const [, kind, key] = /data-log(card|kw|rule|season)="([^"]+)"/.exec(a) ?? [];
  if (kind === 'card') return !data.byId.get(key);
  if (kind === 'kw') return !data.keyword(key);
  if (kind === 'season') return !data.seasons.some((s) => s.rules.some((r) => r.id === key));
  return !data.mechanics.some((m) => m.id === key);
});
check('every row opens something that exists', [targets.length, lost], [96, []]);
check('no Rules line is a Season Rule any more: the Smoke Screens entry keeps no line for one',
  [Object.values(log.rules).flat().filter((e) => e.tags?.includes('OPTIONAL')).length, 'smoke_screen' in log.rules], [0, false]);
const keysOf = (name) => groups.flatMap((g) => g.items).find((i) => i.name === name)?.keys;
check('a card\'s keys are read off its entries',
  [keysOf('MD-4A Reaper Type I'), keysOf('Opal'), keysOf('Mines'), keysOf('Shock Attack X')],
  [['PTS'], ['NEW'], ['NEW', 'CHANGED', 'REVERSED'], ['NAME', 'CHANGED']]);
check('GoF 1.021\'s redesigned Vanguard II carries every kind of key it earned',
  M.R.changelogGroups('1.021').flatMap((g) => g.items).find((i) => /Crossbow/.test(i.name))?.keys, ['NAME', 'PTS', 'STATS', 'ACTION', 'TEXT', 'TAG']);
// The sheet (Popup B): the revision is picked in the title, a search and the
// kinds narrow the list, and a card whose only change is its price shows the
// price instead of a PTS key.
const sheetHtml = M.R.changelogIndex('1.04');
// The revision is picked from our own menu, not a native select, whose list the
// system draws in its own colours (OTTO, 2026-09-30).
check('the sheet picks its revision in the title from its own menu, 1.04 chosen, each with its count',
  [/<button class="cl-ver-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Revision 1\.04">1\.04<span class="cl-ver-caret"/.test(sheetHtml),
    [...sheetHtml.matchAll(/aria-checked="(true|false)" data-clver="([^"]+)"><span>[^<]+<\/span><span class="fc-n">(\d+)<\/span>/g)].map((m) => `${m[2]}:${m[3]}${m[1] === 'true' ? '*' : ''}`),
    /<select/.test(sheetHtml)],
  [true, ['1.04:96*', '1.021:56', '1.02:6'], false]);
check('its kinds carry their counts, and a revision with no Rules lines offers no Rules',
  [[...sheetHtml.matchAll(/data-clkind="([^"]+)">[^<]+<span class="fc-n">(\d+)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`),
    [...M.R.changelogIndex('1.021').matchAll(/data-clkind="([^"]+)"/g)].map((m) => m[1])],
  [['all:96', 'season:2', 'rules:9', 'keywords:11', 'cards:74'], ['all', 'keywords', 'cards']]);
check('the Season Rules wear their own chip, open the list on a line saying they are optional, and each is marked OPTIONAL',
  [/<button class="ref-facet season" data-clkind="season">/.test(sheetHtml),
    /<ul class="ui-list cl-list"><li class="cl-note" data-clk="season" data-cln="">Season Rules are optional: a trial beside the main rules, not part of them\.<\/li><li class="tap" data-logseason="smoke_dissipation"/.test(sheetHtml),
    /data-logseason="stabilize_system" data-clk="season"[^>]*><span class="cl-name"><span class="cl-kind opt">Season · Action change<\/span><span class="ui-row-name">Stabilize System<\/span><\/span><span class="cl-keys"><span class="log-key opt"[^>]*>OPTIONAL<\/span>/.test(sheetHtml)],
  [true, true, true]);
check('it can be searched, and says when nothing matches',
  [/<input id="cl-q" class="cl-q" type="search"/.test(sheetHtml), /<p class="cl-none" hidden>Nothing in 1\.04 matches that\.<\/p>/.test(sheetHtml)], [true, true]);
check('each row says what it is and carries its name for the search',
  /<li class="tap" data-logcard="PRDR-101" data-clk="cards" data-cln="md-4a reaper type i">/.test(sheetHtml), true);
check('a price-only row shows the price, a row with more shows its keys',
  [/data-logcard="PRDR-101"[^>]*>[\s\S]*?<span class="log-pair"><s>90<\/s> → <b>84<\/b><\/span>/.test(sheetHtml),
    /data-logrule="mines"[^>]*>[\s\S]*?<span class="cl-keys"><span class="log-key[^"]*"[^>]*>NEW<\/span><span class="log-key"[^>]*>CHANGED<\/span><span class="log-key warn"[^>]*>REVERSED<\/span><\/span>/.test(sheetHtml)],
  [true, true]);
check('the way in names the newest revision and its count',
  /<button class="cl-entry" data-clv="1\.04">[\s\S]*What changed in 1\.04[\s\S]*74 cards · 11 keywords · 9 rules · 2 optional Season Rules[\s\S]*<span class="ui-badge">96<\/span>/.test(M.R.changelogEntry()), true);
check('a Rules entry opens as a sheet with its Advanced open, the changelog first',
  /<details class="mech-adv" open>[\s\S]*?<div class="mech-adv-b"><div class="mech-log">/.test(M.R.ruleDetail('mines')), true);
// THE REFERENCE IS THREE FILES: its Rules tab and the sheet's behaviours moved
// into refcards.ts and refsheet.ts so the pad shows and does the same
// (OTTO, 2026-09-30). These pins are about what the Reference renders and
// does, so they read the set as one body of source.
const refSrc = ['reference.ts', 'refcards.ts', 'refsheet.ts']
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).join('\n');
check('the Rules tab puts the way in above the quick reference cards, and not under a search',
  /const clEntry = opts\.entries !== false && !q && \(!chosen \|\| chosen\.id === 'cards'\) \? changelogEntry\(\) \+ seasonEntry\(\) : '';\n\s*return total\n\s*\? bar \+ clEntry \+/.test(refSrc), true);
check('a row opens its thing with its Changelog showing, and Back returns to the list',
  [/if \(d\.logcard\) nav\.open\('card', d\.logcard, \{ log: true \}\);/.test(refSrc), /if \(v\.log\) revealLog\(\);/.test(refSrc),
    /kind: 'card' \| 'keyword' \| 'box' \| 'faction' \| 'compare' \| 'changelog' \| 'rule' \| 'season';/.test(refSrc),
    /else if \(d\.logseason\) nav\.open\('season', d\.logseason\);/.test(refSrc)], [true, true, true, true]);
check('Back finds the list filtered as it was left: the filter goes on before the scroll comes back',
  /if \(content\.querySelector\('\.cl-list'\)\) applyChangelogFilter\(content\);\n\s*sheet\(\)\.hidden = false;\n\s*lockRefPage\(\);\n\s*sheetScroller\(\)\.scrollTop = scrollTop;/.test(refSrc), true);
check('the kinds and the search filter in place, and a new revision starts clear',
  [/clFilter\.kind = clkind\.dataset\.clkind!;/.test(refSrc), /if \(el\.id !== 'cl-q'\) return;\n\s*clFilter\.q = /.test(refSrc),
    /const verOpt = t\.closest<HTMLElement>\('\[data-clver\]'\);[\s\S]{0,200}resetChangelogFilter\(\);/.test(refSrc)
    && /export function resetChangelogFilter\(\): void \{\n\s*clFilter\.kind = 'all';\n\s*clFilter\.q = '';/.test(refSrc)], [true, true, true]);
check('the revision menu closes on a click elsewhere, and takes Escape and the arrows before the sheet does',
  [/\n\s*closeVersionMenu\(\);\n\s*\/\/ The master changelog \(OTTO, 2026-09-30\): a revision chip/.test(refSrc),
    /if \(m && !m\.menu\.hidden\) \{\n\s*if \(ev\.key === 'Escape'\) \{\n\s*ev\.preventDefault\(\);\n\s*closeVersionMenu\(true\);\n\s*return true;/.test(refSrc)
    && /if \(runSheetKey\(ev\)\) return;/.test(refSrc),
    /ev\.key === 'ArrowDown' \|\| ev\.key === 'ArrowUp'/.test(refSrc)],
  [true, true, true]);
check('and it is drawn as the site draws a panel: the ladder, the amber tint for the chosen one',
  [/\.cl-ver-menu \{[\s\S]*?background: var\(--surface2\);/.test(css), /\.cl-ver-opt\[aria-checked="true"\] \{ background: var\(--accent-lt\); color: var\(--accent\); \}/.test(css),
    /cl-ver-pick/.test(css)],
  [true, true, false]);

// ---------- the rules, never the apps (OTTO, 2026-09-30) ----------
// "Most users will just use the site as-is and not use our PAD or table", so no
// changelog line, Rules entry or glossary text says what the app, the pad or the
// tabletop does, or what a room shows.
const APP = /\b(the app|this app|the pad|the tabletop|in a room)\b/i;
const said = [
  ...[...Object.values(log.rules), ...Object.values(log.keywords)].flat().map((e) => ['changelog', e.text]),
  ...Object.entries(log.cards).flatMap(([id, es]) => es.map((e) => [id, e.note])),
  ...data.mechanics.flatMap((m) => [m.basic, ...(m.points ?? []), m.text].map((t) => [m.id, t])),
  ...data.keywords.map((k) => [k.key, k.en?.value]),
  ...data.seasons.flatMap((s) => [s.about, ...s.rules.flatMap((r) => [r.basic, r.what, r.main, r.season, ...r.points])].map((t) => [`season ${s.id}`, t])),
].filter(([, t]) => t && APP.test(t)).map(([id, t]) => `${id}: ${t.match(APP)[0]}`);
check('no changelog line, Rules entry, glossary or Season text speaks of the app, the pad or the table', said, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
