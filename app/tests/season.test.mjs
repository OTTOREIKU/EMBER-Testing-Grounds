// The Season Rules (OTTO, 2026-09-30): "maybe we should add a Seasonal
// tag/filter/button to the rules section ... include Stabilize as Action
// Changes and link it in the broader changelog list. We definitely want to make
// sure users realize that some changes are optional and not officially
// adjusted."
//
// The publisher's Supplementary Rules 1.04 end on a "Season Rules" section
// (Stabilize System becomes a Medium Action; 3 Smoke Screens leave each group a
// round), and its Update Notes keep them apart from the main rules as a trial.
// data/mechanics.json `seasons` holds them; this pins the data to the rules it
// sets itself beside, and every place the page shows one to saying it is
// optional.
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

console.log('Season Rules: apart from the main rules, and saying so\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_season.entry.ts', import.meta.url);
const out = new URL('./_season.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { loadData } from '../src/data';\nexport * as R from '../src/refcards';\nexport * as S from '../src/refsearch';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await M.loadData();
M.R.useCardData(data);
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------- the data ----------
const season = data.seasons.at(-1);
check('Season 1.04 loads, with its two rules', [season?.id, season?.label, season?.rules.map((r) => r.id)],
  ['1.04', 'Season 1.04', ['stabilize_system', 'smoke_dissipation']]);
check('Stabilize System is an Action change, the Smoke Screens a Rule change',
  season.rules.map((r) => `${r.name}:${r.kind}`), ['Stabilize System:action', 'Smoke Screens:rule']);
const bad = season.rules.filter((r) => !r.basic || !r.what || !r.main || !r.season || !/^Supplementary Rules 1\.04, 8 [ab]$/.test(r.ref)
  || r.points.length < 2 || r.points.length > 5 || r.points.some((p) => p.length > 140));
check('each says it plainly: a statement, the two values, 2 to 5 short points, and its section', bad.map((r) => r.id), []);
const lostRefs = season.rules.flatMap((r) => [...(r.rule ? [r.rule] : []), ...(r.see ?? [])])
  .filter((id) => !data.mechanics.some((m) => m.id === id));
check('every Rules entry a Season Rule names exists', lostRefs, []);
check('the season says it is optional and apart from the main rules, and that the publisher wants feedback',
  [/^Season Rules are optional\./.test(season.about), /do not change the main rules/.test(season.about), /feedback/.test(season.about)],
  [true, true, true]);

// Each Season value sits beside the main rules' own, so the main half is
// pinned to where the main rule is kept.
const common = JSON.parse(read('../../data/common_actions.json'));
const stab = (Array.isArray(common) ? common : common.actions ?? Object.values(common)).find((a) => a.id === 'COMMON_STABILIZE');
const stabRule = season.rules.find((r) => r.id === 'stabilize_system');
check('Stabilize System: the main rules make it Short, and the Season Medium',
  [stab?.size, stabRule.main, stabRule.season], ['s', 'Short Action, 1 Action Tick', 'Medium Action, 2 Action Ticks']);
check('what it does is the card\'s own, unchanged',
  [/Torso: remove 1 Square Token or 1 Hexagon Token from this Unit, then Restore 1 Link/.test(stab?.description?.en ?? ''),
    stabRule.points.some((p) => /unchanged: Silence, performed with the Torso, remove 1 Square or Hexagon Token, then Restore 1 Link/.test(p))],
  [true, true]);
const ticks = data.mechanics.find((m) => m.id === 'ticks');
check('its cost is read against the Ticks entry: 2 Action Ticks, a Medium costs both, a Reboot leaves 1',
  [/2 Action Ticks/.test(ticks.text), /a Medium costs 2/.test(ticks.text), /After a Reboot a Mech has only 1 Action Tick/.test(ticks.text)],
  [true, true, true]);
const smoke = data.mechanics.find((m) => m.id === 'smoke_screen');
const smokeRule = season.rules.find((r) => r.id === 'smoke_dissipation');
check('the Smoke Screens: the main rules take 1 from each connected group, the Season 3',
  [/one Smoke Screen from each of their Connected groups/.test(smoke.text), smokeRule.main, smokeRule.season],
  [true, '1 Smoke Screen', '3 Smoke Screens']);

// ---------- what the page draws ----------
const card = M.R.seasonCard(stabRule, season);
check('a Season Rule\'s card: the season and the kind of change over it, OPTIONAL beside its name',
  [/<p class="season-k">Season 1\.04 · Action change<\/p>/.test(card), /Stabilize System <span class="log-key opt"[^>]*>OPTIONAL<\/span>/.test(card)],
  [true, true]);
check('then the main rules\' value beside the Season\'s, the points, and its section',
  [/<div class="season-vs-main"><span>Main rules<\/span><b>Short Action, 1 Action Tick<\/b><\/div><div class="season-vs-new"><span>Season 1\.04<\/span><b>Medium Action, 2 Action Ticks<\/b><\/div>/.test(card),
    (card.match(/<li>/g) ?? []).length, /<span class="tag mono">Supplementary Rules 1\.04, 8 a<\/span>/.test(card)],
  [true, 5, true]);
check('and the Rules entries to read with it, as links',
  [/<button class="season-see" data-rulesheet="ticks"><span>Ticks and the Action Opportunity<\/span>/.test(card),
    /data-rulesheet="smoke_screen"><span>Smoke Screens in the main rules<\/span>/.test(M.R.seasonCard(smokeRule, season))],
  [true, true]);
check('the section opens on the banner saying what Season Rules are',
  [/<article class="card season-about">/.test(M.R.seasonAbout(season)), /Not part of the main rules/.test(M.R.seasonAbout(season))], [true, true]);
const sheetHtml = M.R.seasonDetail('stabilize_system');
check('as a sheet: the season and kind as its kicker, the banner before the rule',
  [/<h2>Stabilize System<\/h2><p class="ref-meta season-meta">Season 1\.04 · Action change<\/p>/.test(sheetHtml),
    /<p class="season-banner"><span class="log-key opt"[^>]*>OPTIONAL<\/span><span><b>Not part of the main rules\.<\/b>/.test(sheetHtml),
    M.R.seasonDetail('nothing')],
  [true, true, null]);
check('the Rules tab\'s bar names the season, says optional, and narrows the tab to it',
  /<button class="cl-entry season-entry" data-rules="season">[\s\S]*Season Rules[\s\S]*Season 1\.04 · optional[\s\S]*not part of them[\s\S]*<span class="ui-badge">2<\/span>/.test(M.R.seasonEntry()), true);

// The Rules entry a Season Rule changes keeps the main rule, with a callout.
const smokeBody = M.R.mechanicBody(smoke);
check('the Smoke Screens entry carries the callout under its points, and no "Updated" tag',
  [/<\/ul><button class="season-callout" data-season="smoke_dissipation"><span class="season-callout-t"><span class="season-k">Season 1\.04 · Optional<\/span>Smoke thins faster/.test(smokeBody),
    /mech-adv-new/.test(smokeBody), /class="mech-log"/.test(smokeBody)],
  [true, false, false]);
check('an entry a Season Rule only names carries none', /season-callout/.test(M.R.mechanicBody(ticks)), false);

// ---------- search ----------
check('a search finds a Season Rule by its name, by "season" and by "optional"',
  ['stabilize', 'season', 'optional', 'dissipation', 'zzzz'].map((q) => season.rules.filter((r) => M.S.matchSeason(r, q)).length),
  [1, 2, 2, 1, 0]);

// ---------- the page ----------
// THE REFERENCE IS THREE FILES: its Rules tab and the sheet's behaviours moved
// into refcards.ts and refsheet.ts so the pad shows and does the same
// (OTTO, 2026-09-30). These pins are about what the Reference renders and
// does, so they read the set as one body of source.
const ref = ['../src/reference.ts', '../src/refcards.ts', '../src/refsheet.ts'].map(read).join('\n');
check('the Rules tab has a Season section, last, in its own blue, opening on the banner',
  [/\{ id: 'mechanics', label: 'Mechanics', n: filtered\.length, html: mechanicHtml \},\n\s*\{ id: 'season', label: 'Season', n: seasonList\.length, html: seasonHtml \},\n\s*\];/.test(ref),
    /\$\{x\.id === 'season' \? ' season' : ''\}/.test(ref),
    /`<p class="ref-count season-count">Season Rules<\/p>` \+ seasonAbout\(season\) \+ seasonList\.map\(\(r\) => seasonCard\(r, season\)\)/.test(ref)],
  [true, true, true]);
check('its chip stands first after All, as in the master changelog, while its section stays last',
  /const chips = \[\.\.\.sections\.filter\(\(x\) => x\.id === 'season'\), \.\.\.sections\.filter\(\(x\) => x\.id !== 'season'\)\];/.test(ref), true);
check('the tab badge and the everywhere search count the Season Rules, and a hit opens its sheet',
  [/\(currentSeason\(\)\?\.rules \?\? \[\]\)\.filter\(\(r\) => matchSeason\(r, q\)\)\.length/.test(ref),
    /chip\(`data-season="\$\{esc\(s\.id\)\}"`, s\.name, `\$\{season!\.label\} · optional`\)/.test(ref)],
  [true, true]);
check('a Season Rule opens as a sheet, from the callout, a search or the changelog, and its links open the Rules entries',
  [/if \(kind === 'season'\) return seasonDetail\(key\);/.test(ref),
    /const seasonLink = t\.closest<HTMLElement>\('\[data-season\]'\);[\s\S]{0,120}nav\.open\('season', seasonLink\.dataset\.season!\);/.test(ref),
    /const ruleSheet = t\.closest<HTMLElement>\('\[data-rulesheet\]'\);[\s\S]{0,120}nav\.open\('rule', ruleSheet\.dataset\.rulesheet!\);/.test(ref),
    /return `\$\{name\} \(Season Rule\)`;/.test(ref),
    /open\.kind === 'rule' \|\| open\.kind === 'season' \? 'rules'/.test(ref)],
  [true, true, true, true, true]);
check('a chosen chip past the edge of the scrolling row is brought into view, the page left where it is',
  /if \(row && on && row\.scrollWidth > row\.clientWidth\) \{\n\s*row\.scrollLeft = /.test(ref), true);
check('the changelog\'s note shows with the Season rows, not under a search, and is never a match',
  [/li\[data-clk\]:not\(\.cl-note\)/.test(ref), /li\.hidden = !!q \|\| !\(clFilter\.kind === 'all' \|\| li\.dataset\.clk === clFilter\.kind\);/.test(ref)],
  [true, true]);
const css = read('../src/reference.css');
check('the styles: the blue chip, the banner across the columns, the note row',
  [/\.ref-facet\.season\.active \{ background: var\(--blue-lt\); color: var\(--blue\); \}/.test(css),
    /\.card\.season-about \{ grid-column: 1 \/ -1;/.test(css),
    /\.ui-list\.cl-list > li\.cl-note \{/.test(css)],
  [true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
