// HTML injection (found 2026-09-28): a unit's name, a squad's name or anything
// the relay delivers could carry markup into the page, where it ran as script.
// Three walls, each pinned here: the Content-Security-Policy in every page, the
// cleaner that takes angle brackets out of names and out of whatever arrives
// (safetext.ts), and the escape helpers every page draws text through.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const T = await import('./../src/safetext.ts');

console.log('Safe text\n');

// ---------- the cleaner ----------
check('a name loses its angle brackets and keeps the rest as plain text',
  T.cleanName('<img src=x onerror=alert(1)>Bob'), 'img src=x onerror=alert(1)Bob');
check('and its control and direction characters, with the spacing tidied',
  T.cleanName(' Bo\u202eb\n\tthe\u0000  Mech '), 'Bob the Mech');
check('an ordinary name is untouched, apostrophes and ampersands included',
  T.cleanName("Otto's Dune Brawler & co"), "Otto's Dune Brawler & co");
check('every string in a delivered message loses its brackets, keys too',
  T.cleanStrings({ kind: 'renameUnit', label: '<b>x</b>', deep: [{ statusId: '<svg onload=1>' }], '<k>': 1, n: 3, yes: true, none: null }),
  { kind: 'renameUnit', label: 'bx/b', deep: [{ statusId: 'svg onload=1' }], k: 1, n: 3, yes: true, none: null });
check('a message with nothing to clean comes through equal',
  T.cleanStrings({ t: 'cmd', rev: 4, cmd: { kind: 'maneuver', to: { col: 1, row: 2 }, via: [] } }),
  { t: 'cmd', rev: 4, cmd: { kind: 'maneuver', to: { col: 1, row: 2 }, via: [] } });
const polluted = T.cleanStrings(JSON.parse('{"__proto__": {"polluted": "yes"}, "a": 1}'));
check('a __proto__ key is dropped rather than assigned', [Object.getPrototypeOf(polluted) === Object.prototype, polluted.polluted, {}.polluted], [true, undefined, undefined]);
let deep = { v: '<x>' };
for (let i = 0; i < 80; i++) deep = { d: deep };
let node = T.cleanStrings(deep), levels = 0;
while (node && node.d) { node = node.d; levels++; }
check('a structure nested past any honest depth is cut off, not walked', levels < 80 && node.d === null, true);
check('escapeHtml covers text and both kinds of quoted attribute',
  T.escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');

// ---------- every escape helper the pages use ----------
// Found by name rather than listed, so a helper added next month is held to
// the same rule. Each is evaluated for real on a hostile string.
const HELPER = /(?:function (esc|escape\w*|escAttr|attr)\((\w+): string\): string \{\s*return ([\s\S]*?);\s*\}|const (esc|escape\w*|escAttr|attr) = \((\w+): string\)(?:: string)? =>\s*([\s\S]*?);\n)/g;
const found = [];
for (const dir of ['src', 'pad']) {
  for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (!f.endsWith('.ts')) continue;
    // Some modules are saved with CRLF endings; the pattern reads LF.
    const text = src(`../${dir}/${f}`).replace(/\r\n/g, '\n');
    for (const m of text.matchAll(HELPER)) {
      const [name, param, body] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
      if (!body.includes('&amp;')) continue;
      found.push({ where: `${dir}/${f} ${name}`, fn: new Function(param, `return ${body.replace(/\)\[(\w+)\]!/g, ')[$1]')};`) });
    }
  }
}
check('the escape helpers are all found (one per page module, plus the shared one)', found.length >= 17, true);
const probe = `<img src="x" onerror='y'>&amp;`;
for (const h of found) {
  const out = h.fn(probe);
  check(`${h.where}: no bracket or double quote survives, and & is escaped first`,
    [/[<>"]/.test(out), out.includes('&amp;amp;')], [false, true]);
}

// ---------- the policy in every page ----------
const PAGES = ['index.html', 'pad/index.html', 'reference/index.html', 'table/index.html', 'table/match/index.html'];
for (const p of PAGES) {
  const html = src(`../${p}`);
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html);
  check(`${p} carries the policy`, !!m, true);
  if (!m) continue;
  const pol = Object.fromEntries(m[1].split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  const hashes = inline.map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`);
  check(`${p}: scripts come only from the site, never inline or eval'd`,
    [pol['script-src']?.[0], pol['script-src']?.some((v) => /unsafe/.test(v))], ["'self'", false]);
  check(`${p}: each inline script is allowed by its own hash and nothing else is`,
    (pol['script-src'] ?? []).slice(1).sort(), hashes.sort());
  check(`${p}: no plugins, no <base> retargeting, no form posting elsewhere`,
    [pol['object-src']?.join(' '), pol['base-uri']?.join(' '), pol['form-action']?.join(' ')], ["'none'", "'self'", "'self'"]);
  check(`${p}: the policy is read before any script`, html.indexOf('Content-Security-Policy') < html.indexOf('<script'), true);
}
// The policy would break a page that leaned on inline handlers or eval, so the
// sources are held to never using them.
let inlineHandlers = 0, evals = 0;
for (const dir of ['src', 'pad']) {
  for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (!f.endsWith('.ts')) continue;
    const text = src(`../${dir}/${f}`);
    inlineHandlers += (text.match(/<[a-z][^<>]*\son[a-z]+=["']/g) ?? []).length + (text.match(/javascript:/g) ?? []).length;
    evals += (text.match(/\beval\(|new Function\(/g) ?? []).length;
  }
}
check('no page writes an inline event handler or a javascript: link', inlineHandlers, 0);
check('and none evaluates strings as code', evals, 0);

// ---------- where the cleaner is wired ----------
check('the relay cleans every message before anything reads it',
  /msg = cleanStrings\(JSON\.parse\(raw\) as typeof msg\);/.test(src('../src/net.ts')), true);
const units = src('../src/units.ts');
check('every board loaded from outside - a save, a replay, a file, a checkpoint - is cleaned',
  /export function migrateState\(rawIn: unknown, data: GameData\): GameState \| null \{[\s\S]{0,400}?const raw = migrateSideIds\(cleanStrings\(rawIn\)\);/.test(units), true);
check('a mech named in a list or a build takes a clean name',
  /const typed = name \? cleanName\(name\) : '';\s*if \(typed\) return tidyUnitLabel\(typed\);/.test(units), true);
const commands = src('../src/commands.ts');
check('renameUnit judges and stores the clean name',
  [/case 'renameUnit': \{\s*const label = typeof cmd\.label === 'string' \? cleanName\(cmd\.label\) : '';/.test(commands),
    /case 'renameUnit': \{\s*t\.label = cleanName\(cmd\.label\);/.test(commands)], [true, true]);
check('a squad list names its squad with a clean name',
  /const squadName = typeof cmd\.name === 'string' \? cleanName\(cmd\.name\) : '';\s*if \(squadName && !state\.sideNames\?\.\[cmd\.seat\]\)/.test(commands), true);
check('a rollback request carries a clean label to the other player',
  /label: cleanName\(String\(cmd\.label \?\? ''\)\) \|\| 'an action'/.test(commands), true);
check('the squad panel rename cleans what was typed',
  /const trimmed = cleanName\(next\);/.test(src('../src/squads.ts')), true);
check('and so does its squad rename', /const clean = cleanName\(name\);\s*if \(clean\) next\[side\] = clean;/.test(src('../src/squads.ts')), true);

// ---------- the hover box ----------
// It draws what it is given as HTML, and its text comes from everywhere:
// unit names, squad names, refusal reasons and data-tip attributes (read back
// decoded). So it escapes unless a producer says it built its own markup.
const inspector = src('../src/inspector.ts');
check('the hover box escapes its title, sub and lines by default',
  [/const text = info\.html \? \(s: string\) => s : escapeHtml;/.test(inspector),
    /<h4>\$\{text\(info\.title\)\}/.test(inspector), /\$\{text\(info\.sub\)\}/.test(inspector), /<li>\$\{text\(l\)\}<\/li>/.test(inspector)],
  [true, true, true, true]);
let htmlProducers = 0;
for (const dir of ['src', 'pad']) {
  for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (f.endsWith('.ts')) htmlProducers += (src(`../${dir}/${f}`).match(/\bhtml: true,/g) ?? []).length;
  }
}
check('only the three hovers that build their own markup opt out', htmlProducers, 3);
const panel = src('../src/panel.ts');
check('the unit panel\'s Action hover escapes every text it holds',
  [/lines\.push\(\.\.\.rulesLines\(en\)\.map\(escapeHtml\)\);/.test(panel), /title: escapeHtml\(actName\),/.test(panel)], [true, true]);
const squads = src('../src/squads.ts');
check('the Stance hover escapes the rulebook text around its bold lead-ins',
  /`<b>Use it when<\/b> \$\{esc\(def\.good\)\}`/.test(squads), true);
check('the Link hover prints the Link as a number', /title: `\$\{bolt\}Link \$\{Number\(t\.link \?\? 0\)\}/.test(squads), true);

// ---------- a missing cover image ----------
// The inline onerror that removed it is refused by the policy, so one
// capturing listener does it, started by each page that draws covers.
check('a failed cover is removed by the shared listener',
  /export function watchImageFallbacks\(\): void \{[\s\S]{0,400}img\.closest\(img\.dataset\.gone\)\?\.remove\(\);/.test(src('../src/images.ts')), true);
check('the tabletop and the Reference start it',
  [/async function init\(\) \{\s*watchImageFallbacks\(\);/.test(src('../src/main.ts')), /async function init\(\): Promise<void> \{\s*watchImageFallbacks\(\);/.test(src('../src/reference.ts'))], [true, true]);

// ---------- the pad draws no raw board ----------
check('a board the pad cannot migrate waits for the card data, and is never cast raw',
  /if \(m\) table = m;\s*else if \(!data\) waitingBoard = s;/.test(src('../pad/pad.ts')) && !/\(s as GameState\) : table/.test(src('../pad/pad.ts')), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
