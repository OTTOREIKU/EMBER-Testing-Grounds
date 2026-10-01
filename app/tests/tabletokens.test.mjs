// Tokens on the table (OTTO, 2026-10-01): "include them in the reference app so
// players can see what they look like when they are playing on an actual
// table". The Rules tab lists every physical piece, grouped by where it sits,
// both faces shown and named. data/tokens.json is the list; a token the engine
// also tracks is joined to its StatusDef, so its rule is written once.
//
// What this holds:
//   - the list is whole: every picture it names exists, every token the engine
//     tracks appears exactly once, and one the list forgot would still show;
//   - the section draws what the list says, for the Reference and the pad alike
//     (both draw refcards.ts), and a search finds a token by its name, its
//     family and the name of a face;
//   - the text states the rule alone, with its source on the card's foot;
//   - OTTO's two notes on the first look: the Rules-entry buttons sit on one
//     line at the foot of every card, and the Task Items are an outline until
//     real token pictures are found.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Tokens on the table\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_tabletokens.entry.ts', import.meta.url);
const out = new URL('./_tabletokens.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData, TOKEN_PRINT } from '../src/data';",
  "export * as R from '../src/refcards';",
  "export { SHAPE_NOTE, STATUSES } from '../src/types';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await M.loadData();
M.R.useCardData(data);

const file = JSON.parse(readFileSync(new URL('../../data/tokens.json', import.meta.url), 'utf8'));
const art = (name) => existsSync(new URL(`../../assets/tokens/print/${name}.webp`, import.meta.url));
const statusIds = (t) => (t.status === undefined ? [] : Array.isArray(t.status) ? t.status : [t.status]);

// ---------- the list ----------
const ids = file.tokens.map((t) => t.id);
check('no token is listed twice', ids.filter((id, i) => ids.indexOf(id) !== i), []);
check('every token belongs to a family the file defines',
  file.tokens.filter((t) => !file.families.some((f) => f.id === t.family)).map((t) => t.id), []);
check('every picture it names is a file on the site',
  file.tokens.flatMap((t) => (t.faces ?? []).map((f) => f.art)).filter((a) => !art(a)), []);
check('every Rules entry it points at exists',
  file.tokens.flatMap((t) => t.see ?? []).filter((id) => !data.mechanics.some((m) => m.id === id)), []);
check('every token carries its source, so every card ends the same way',
  file.tokens.filter((t) => !t.ref).map((t) => t.id), []);
const namedStatuses = file.tokens.flatMap(statusIds);
check('every token the engine tracks is listed, once',
  M.STATUSES.map((s) => s.id).filter((id) => namedStatuses.filter((x) => x === id).length !== 1), []);
check('and the list names none the engine does not have',
  namedStatuses.filter((id) => !M.STATUSES.some((s) => s.id === id)), []);
check('a token with its own text has a name, and one joined to the engine borrows both',
  file.tokens.filter((t) => (statusIds(t).length ? false : !t.name || !t.text)).map((t) => t.id), []);

// ---------- the entries, as the section reads them ----------
const entries = M.R.tokenEntries();
const by = (id) => entries.find((e) => e.id === id);
check('every token, in the families\' order',
  entries.map((e) => e.name),
  ['Ammunition', 'Charge', 'Interception', 'Command', 'Damaged', 'Repaired',
    'Fire Control Interference', 'Fragile', 'Hindered', 'Immobilized',
    'Low Profile', 'Highlight', 'Target Tracer', 'Pursuit', 'Stance',
    'First Player Token', 'Landing Point Token', 'Smoke Screen', 'Numeric Identifier', 'Task Item Tokens', 'Victory Point',
    'Optical Camouflage', 'In smoke']);
check('the families are the rulebook\'s, in the file\'s order',
  [...new Set(entries.map((e) => e.family.id))], file.families.map((f) => f.id));
check('a Round Token shows both faces, and says what each means',
  ['ammo', 'charge', 'interception'].map((id) => by(id).faces.map((f) => `${f.art}=${f.label}`)),
  [['ammo=Available', 'ammo-used=Consumed'], ['charge-green=Charged', 'charge-used=Not charged'], ['interception=Available', 'interception-used=Consumed']]);
check('Command is one token with two faces, and keeps both of the engine\'s texts',
  [by('command').name, by('command').faces.map((f) => f.label), by('command').texts.length,
    by('command').texts.join(' ') === M.STATUSES.filter((s) => s.id === 'command' || s.id === 'commandUsed').map((s) => s.note).join(' ')],
  ['Command', ['Ready', 'Spent'], 2, true]);
check('a token the engine tracks takes its faces from the pictures it already has, named by colour',
  ['fci', 'lowProfile', 'targetTracer'].map((id) => by(id).faces.map((f) => `${f.art}=${f.label}`)),
  [['fci-yellow=Yellow', 'fci-red=Red'], ['lowProfile-green=Green', 'lowProfile-red=Red'], ['targetTracer-yellow=Yellow', 'targetTracer-red=Red']]);
check('one red on both faces shows only that face, and a Triangle Token its one',
  [by('pursuit').faces.map((f) => `${f.art}=${f.label}`), by('repaired').faces.map((f) => f.label), by('damaged').faces.map((f) => f.label)],
  [['targetTracer-red=Both faces'], ['Both faces'], ['Both faces']]);
check('its text is the engine\'s own, word for word',
  ['fci', 'fragile', 'repaired', 'camouflage'].map((id) => by(id).texts.join('') === M.STATUSES.find((s) => s.id === id).note), [true, true, true, true]);
check('and its note says where it sits, then how long it lasts',
  [by('fragile').note, by('lowProfile').note.startsWith('Hexagon Token. It sits beside the model. Stays in effect'), by('ammo').note],
  ['Square Token. It sits beside the model. Flipped to its red reverse at the end of the round, then removed at the end of the next one, so it lasts the rest of the round it arrives in and all of the next.',
    true, 'Round Token. It sits on the Part Card.']);
// OTTO, 2026-10-01: "Lets remove the task item image since its not an actual
// token image ... We can just draw the shape and find individual images later".
check('the Task Items are an outline of their shape until real pictures are found',
  [by('taskItems').faces, by('taskItems').shape, by('taskItems').caption, art('task-items')], [[], 'pentagon', 'No picture yet', false]);
check('Hindered has no printed piece at all, and says so',
  [by('hindered').faces, by('hindered').caption], [[], 'No printed piece']);
check('the pictures cut from the rulebook are on the site',
  ['smoke-white', 'smoke-black', 'victory-point', 'numeric-white', 'numeric-black', 'damaged', 'first-player-black', 'first-player-white', 'landing-point'].filter((a) => !art(a)), []);

// A token added to the engine and forgotten here must not vanish.
M.R.useCardData({ ...data, tableTokens: { families: file.families, tokens: file.tokens.filter((t) => t.id !== 'fragile' && t.id !== 'command') } });
const short = M.R.tokenEntries();
check('a token the list forgot still shows, in the family of its shape',
  [short.length, ['fragile', 'command', 'commandUsed'].map((id) => short.find((e) => e.id === id)?.family.id)],
  [entries.length + 1, ['square', 'round', 'round']]);
const rankOf = (e) => file.families.findIndex((f) => f.id === e.family.id);
check('and it is listed with its family, not after everything else',
  short.every((e, i) => i === 0 || rankOf(short[i - 1]) <= rankOf(e)), true);
M.R.useCardData({ ...data, tableTokens: { families: [], tokens: [] } });
check('and with no list at all the section is the engine\'s own tokens',
  M.R.tokenEntries().map((e) => e.id), M.STATUSES.map((s) => s.id));
M.R.useCardData(data);

// ---------- the section ----------
const section = (q) => M.R.rulesSections(q).find((s) => s.id === 'tokens');
const whole = section('');
const count = (html, re) => (html.match(re) ?? []).length;
check('the section lists every token, under its own name',
  [whole.label, whole.n, whole.tiles.length, /<p class="ref-count">Tokens on the table<\/p>/.test(whole.html)], ['Tokens', 23, 23, true]);
check('each family opens on one line saying what its shape means',
  [count(whole.html, /<div class="tok-fam">/g), count(whole.html, /class="tok-fam-text"/g)], [7, 7]);
check('the picture index has one picture for every token that has one',
  [count(whole.html, /class="tok-jump"/g), entries.filter((e) => e.faces.length).length], [19, 19]);
check('every picture the section draws exists',
  [...whole.html.matchAll(/assets\/tokens\/print\/([\w-]+)\.webp/g)].map((m) => m[1]).filter((a) => !art(a)), []);
check('every tile is a whole card: its name, its source, and where to jump to it',
  whole.tiles.filter((t) => !/data-tok="[\w-]+"/.test(t) || !/class="card-title"/.test(t) || !/class="card-foot"><span class="tag mono">/.test(t)).length, 0);
check('a face is named under its picture, and the picture says what it is',
  [/<img class="tok-print" src="[^"]*ammo-used\.webp" alt="Ammunition, Consumed" decoding="async">\s*<figcaption>Consumed<\/figcaption>/.test(whole.html),
    /alt="First Player Token, Black goes first"/.test(whole.html)], [true, true]);
check('a piece with no picture is drawn as a dashed outline, a State keeps its badge',
  [count(whole.html, /class="tok-outline"/g), count(whole.html, /class="tok-badge"/g),
    /data-tok="taskItems"[\s\S]*?<polygon points="31,4 59,24 48,57 14,57 3,24"[\s\S]*?<figcaption>No picture yet<\/figcaption>/.test(whole.html)],
  [2, 2, true]);
check('the four Stance tokens take a row of their own', /class="card tok-card tok-wide" data-tok="stance"/.test(whole.html), true);
check('a token points at the Rules entry to read with it',
  [/data-tok="smokeScreen"[\s\S]*?<button class="rule-see" data-rulesheet="smoke_screen"><span>Smoke Screens<\/span>/.test(whole.html),
    /data-tok="victoryPoint"[\s\S]*?data-rulesheet="victory_points"/.test(whole.html)], [true, true]);

// A search lists what it found, with no groups and no index, and the tab's
// badge counts the same tokens the tab then shows.
const names = (q) => section(q).tiles.map((t) => /class="card-title">([^<]+)/.exec(t)[1].trim());
check('a search finds a token by its name', [names('ammo'), names('first player'), names('landing')],
  [['Ammunition'], ['First Player Token'], ['Landing Point Token']]);
check('by the name of a face', names('consumed'), ['Ammunition', 'Interception', 'Command']);
check('by its shape', names('hexagon').slice(0, 4), ['Low Profile', 'Highlight', 'Target Tracer', 'Pursuit']);
// Only the family's name says this: a token's own note says "the Part Card".
check('and by where its family sits', names('on the cards'), ['Ammunition', 'Charge', 'Interception', 'Command', 'Damaged', 'Repaired']);
check('and smoke finds the card and the State', names('smoke'), ['Smoke Screen', 'In smoke']);
check('with no family lines and no index in the way',
  [/tok-fam/.test(section('ammo').html), /tok-index/.test(section('ammo').html)], [false, false]);
check('the count on the tab is the count in the tab',
  ['', 'ammo', 'token', 'red', 'zzzz'].map((q) => section(q).n === M.R.tokenEntries().filter((e) => M.R.matchTokenEntry(e, q)).length),
  [true, true, true, true, true]);

// The Stances cards show the token that marks each Stance.
const stances = M.R.rulesSections('').find((s) => s.id === 'stances');
check('each Stance card carries its Stance token',
  [...stances.html.matchAll(/<img class="stance-print" src="[^"]*\/(stance-[a-z]+)\.webp"/g)].map((m) => m[1]),
  ['stance-offensive', 'stance-defensive', 'stance-mobility', 'stance-shutdown']);

// ---------- the text ----------
const own = file.tokens.filter((t) => t.text).map((t) => [t.id, t.text]);
const said = [...own, ...file.families.map((f) => [f.id, f.text]), ...file.tokens.map((t) => [t.id, t.note ?? ''])];
// The Reference states the rule alone (OTTO, 2026-09-30): no app, pad or room.
const APP = /\b(the app|this app|the pad|the tabletop|in a room|in the physical game)\b/i;
check('no token text speaks of the app, the pad or the table', said.filter(([, t]) => APP.test(t)).map(([id]) => id), []);
check('the rule numbers are on the card\'s foot, not in its sentences',
  own.filter(([, t]) => /\(\d+\.\d|\bFAQ [A-Z]\d|rulebook/i.test(t)).map(([id]) => id), []);
const A = /<a class="kw-link" data-(kw|card)="([^"]*)">([\s\S]*?)<\/a>/g;
const lower = [];
for (const [id, text] of said) {
  for (const m of M.R.linkKeywords(text).matchAll(A)) {
    const shown = m[3].replace(/<[^>]+>/g, '');
    if (m[1] === 'kw' && /^[a-z]/.test(shown)) lower.push(`${id}: ${shown}`);
  }
}
check('no lower-case word in it links to a keyword', lower, []);
// "Smoke Grenade" with no model number is the Projectile subtype printed on the
// card's banner, which has a glossary entry of its own. No one card bears that
// bare name, so the link is to the entry.
check('a keyword it prints with its capital links the glossary',
  [...M.R.linkKeywords(file.tokens.find((t) => t.id === 'smokeScreen').text).matchAll(A)].map((m) => `${m[1]}:${m[3]}`),
  ['kw:Projectile', 'kw:Smoke Grenade']);
// 2.5.4 is the Stance Tokens. A State is defined where its rule is.
check('a State cites no section it is not defined in', [/2\.5\.4/.test(M.SHAPE_NOTE.state), M.SHAPE_NOTE.state], [false, 'Not a token. This is a State the unit is in.']);

// ---------- how it is drawn and answered ----------
const css = readFileSync(new URL('../src/reference.css', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/refsheet.ts', import.meta.url), 'utf8');
const ref = readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8');
// OTTO, 2026-10-01: "make sure the mechanics buttons are all sitting on the
// same line at the bottom ... right now they are all staggered".
check('the Rules-entry buttons are pinned to the foot of the card, the source under them',
  [/\.tok-card \.rule-sees \{ margin-top: auto; padding-top: 10px; \}/.test(css), /\.tok-card \.rule-sees \+ \.card-foot \{ margin-top: 0; \}/.test(css)],
  [true, true]);
check('the index, a family\'s line and the Stance row run the full width of the wide grid',
  /\.tok-index, \.tok-fam, \.tok-wide \{ grid-column: 1 \/ -1;/.test(css), true);
check('every picture carries a hairline that follows its shape, since the black faces sit close to the page',
  [/\.tok-print \{[^}]*filter: drop-shadow\(0 0 1px var\(--text3\)\);/.test(css), /\.tok-jump img \{[^}]*filter: drop-shadow/.test(css)], [true, true]);
check('nothing in it is boxed by an outline (ui.css rule 1)', /\.tok-(?:jump|card|fam|index|face)[^{]*\{[^}]*border: 1px/.test(css), false);
check('the picture index moves the page to its token, at once, on the Reference and the pad alike',
  [/const jump = t\.closest<HTMLElement>\('\[data-tokjump\]'\);/.test(sheet), /scrollIntoView\(\{ block: 'center' \}\)/.test(sheet), /behavior: 'smooth'/.test(sheet)],
  [true, true, false]);
check('the Reference counts the tokens it will show',
  [count(ref, /tokenEntries\(\)\.filter\(\(e\) => matchTokenEntry\(e, q\)\)\.length/g), /matchStatus/.test(ref)], [2, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
