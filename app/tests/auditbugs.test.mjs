// The bugs the notices audit turned up (2026-09-28), fixed after the HTML
// injection one. Read as source: each is a line of page glue that said the
// wrong thing, or said it where nobody could see it.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

console.log('Audit bugs\n');

// ---------- Match Centre: a success note never covers a refusal ----------
// A refused command writes its reason into the note line (onRefused). A
// success note written straight after an unchecked send replaced it, so the
// player read that something happened when it had been refused.
const hud = src('../src/matchhud.ts');
const bare = [...hud.matchAll(/^[ \t]*ctx\.send\([^\n]*\);[ \t]*\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*(?:[a-zA-Z]+ = [^\n]*;\n[ \t]*)?ctx\.noteNow\(/gm)]
  .map((m) => hud.slice(0, m.index).split('\n').length);
check('no Match Centre note follows a send whose result it never read', bare, []);
check('the drag note waits for both of its commands',
  /const paidTow = ctx\.send\([^\n]*\)\.ok;\s*const towed = ctx\.send\([^\n]*\)\.ok;\s*if \(paidTow && towed\) ctx\.noteNow\(/.test(hud), true);
// The Counter-roll's sender is contest.ts since 2026-10-01 (the Match Centre
// and a computer seat share it): the same two rules, read where it lives.
const contest = src('../src/contest.ts');
check('nor does the Counter-roll\'s sender',
  [...contest.matchAll(/^[ \t]*send\([^\n]*\);[ \t]*\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*(?:[a-zA-Z]+ = [^\n]*;\n[ \t]*)?say\(/gm)].map((m) => contest.slice(0, m.index).split('\n').length), []);
check('a won Counter-roll sends every command and speaks only if all landed',
  /let won = true;\s*for \(const cmd of win\.cmds\) won = send\(cmd\)\.ok && won;\s*if \(won\) say\(/.test(contest), true);
check('the detonation note on terrain needs a projectile and a landed command',
  /if \(proj && ctx\.send\(\{ kind: 'destroyTerrain'[^\n]*\}\)\.ok\) \{\s*ctx\.noteNow\('A Container is Breakable/.test(hud), true);

// The pad had the same habit with its toasts: a refused send puts its reason in
// the red line, and the toast straight after said it had happened anyway.
for (const [file, prefix] of [['../pad/pad.ts', ''], ['../pad/guided.ts', 'api\\.']]) {
  const text = src(file);
  const re = new RegExp(`^([ \\t]*)${prefix}send\\([^\\n]*\\);[ \\t]*\\n\\1${prefix}toast\\(`, 'gm');
  check(`${file.slice(3)}: no toast follows a send whose result it never read`,
    [...text.matchAll(re)].map((m) => text.slice(0, m.index).split('\n').length), []);
}

// ---------- Match Centre: the relay's own words are shown ----------
const match = src('../src/match.ts');
check('the bar says what the relay says while it reconnects or catches up',
  [/v\.status === 'connecting'\s*\? `<span class="pill bad">● \$\{esc\(v\.error \?\? 'reconnecting'\)\}<\/span>`/.test(match),
    /: v\.desynced\s*\? `<span class="pill bad">● \$\{esc\(v\.error \?\? 'catching up'\)\}<\/span>`/.test(match)], [true, true]);
check('a refused join says why on the door, a dropped line does not',
  /else if \(view\.error && !view\.room\) \{ forgetRoom\(\); if \(view\.status !== 'connecting'\) doorErr = view\.error; \}/.test(match), true);

// ---------- the pad ----------
const pad = src('../pad/pad.ts');
const padCss = src('../pad/pad.css');
const cut = (text, from, to) => { const a = text.indexOf(from); return a < 0 ? '' : text.slice(a, text.indexOf(to, a + from.length)); };
const closed = cut(pad, 'onClosed: () => {', '},');
check('"the other player closed the table" is said on the lobby, where the player now is',
  [/error = 'The other player closed the table\.';/.test(closed), /toast\(|notify\(/.test(closed)], [true, false]);
check('a remote command the pad refused is not announced (its Undo would point elsewhere)',
  /const landed = applyRemote\(data, table, cmd as Command\)\.ok;[\s\S]{0,200}if \(landed\) toastRemote\(cmd as Command\);/.test(pad), true);
check('an announced move\'s Undo lasts only while it is the newest step',
  /function undoWhileLast\(\): \(\) => boolean \{\s*const at = snapshotBack\(0\)\?\.seq;\s*return \(\) => at !== undefined && snapshotBack\(0\)\?\.seq === at;/.test(pad), true);
check('Link "-" is greyed at 0 Link, which the engine check never refuses',
  /data-act="link-down"[^\n]*\$\{link > 0 \? greyIf\(/.test(pad), true);
check('the phase button is greyed for real when Guided cannot continue',
  /data-act="phase"\$\{stalled \? greyWhy\(true, /.test(pad), true);
check('the other squad\'s Secondary card looks as unavailable as it is', /\.pad-task\.discarded, \.pad-task:disabled \{ opacity: 0\.45; \}/.test(padCss), true);
check('controls the engine refuses are greyed with their reason, never merely disabled',
  [(pad.match(/can\(\{[^{}]*\}\) \? '' : ' disabled'/g) ?? []).length, /function greyIf\(cmd: Command\): string \{/.test(pad), /explainOnHold\(root\);/.test(pad)], [0, true, true]);
check('and one greyed look for every pad control',
  (padCss.match(/(?:pad-btn|pad-chip|pad-step|pad-stance):disabled, \.(?:pad-btn|pad-chip|pad-step|pad-stance)\[aria-disabled="true"\] \{ opacity: 0\.4; cursor: default; \}/g) ?? []).length, 4);
const combatCss = src('../src/combat.css');
check('the combat window carries its own hover popup and link cue, so the pad styles them',
  [/#inspect-pop \{[^}]*position: fixed/.test(combatCss), /\.mech-link \{/.test(combatCss), /\.inspect-pinnable \{/.test(combatCss), /import '\.\.\/src\/combat\.css';/.test(pad)],
  [true, true, true, true]);

// ---------- the tabletop and its guide ----------
const guide = src('../src/playguide.ts');
check('a strict game refuses a blocked Action on every press, not only the first',
  (guide.match(/if \(why && \(strictNow\(s\) \|\| this\.warn !== why\)\) \{/g) ?? []).length, 2);
check('the Task designation buttons have their own attribute',
  [/data-task-designate="\$\{i\}"/.test(guide), /'\[data-task-designate\]'/.test(guide), (guide.match(/'\[data-designate\]'/g) ?? []).length], [true, true, 1]);
check('the unit-picking panel draws its warning, and a new phase starts without the last one\'s',
  [/<small>pick a \$\{noun\} to \$\{verb\}<\/small><\/p>\s*\$\{this\.warn \? `<p class="pg-warn">/.test(guide),
    /if \(sc\.stage === now \|\| sc\.stage === `\$\{now\}:locked`\) return false;\s*this\.warn = null;/.test(guide)], [true, true]);
const bound = [...guide.matchAll(/querySelectorAll<[^>]+>\('\[data-([a-z-]+)\]'\)/g)].map((m) => m[1]);
const drawn = (name) => new RegExp(`data-${name}=`).test(guide.replace(/querySelectorAll<[^>]+>\('\[data-[a-z-]+\]'\)/g, ''));
check('every door the guide binds is drawn somewhere, and none is bound twice',
  [bound.filter((b) => !drawn(b)), bound.filter((b, i) => bound.indexOf(b) !== i)], [[], []]);
const main = src('../src/main.ts');
check('a freeplay command the rules refuse is refused, not applied and then called refused',
  [/function performChecked\(cmd: Command\): ReturnType<typeof check> \{\s*const v = check\(data, state, cmd\);\s*if \(v\.ok\) perform\(data, state, cmd\);/.test(main),
    (main.match(/performChecked\(/g) ?? []).length], [true, 11]);
check('the Remove confirmation no longer says there is no undo', /There is no undo/.test(main), false);
const squads = src('../src/squads.ts');
check('a damage click on the Squads tab goes through the command', /perform\(this\.data, this\.state!, \{ kind: 'setPartState', seat: t\.side === 's1' \? 's2' : 's1'/.test(squads), true);
check('the squad panel greys Link "-" and "+" when the rules would refuse them',
  [/const spend = check\(this\.data, this\.state!, \{ kind: 'focus'/.test(squads), /\$\{spend\.ok \? '' : ' disabled'\}>−<\/button>/.test(squads), /\$\{recover\.ok \? '' : ' disabled'\}>\+<\/button>/.test(squads)],
  [true, true, true]);

// ---------- the report form says when something failed ----------
const ui = src('../src/reportui.ts');
check('a failed copy turns the status red, a save turns it back',
  [/said\.classList\.toggle\('bad', !ok\);/.test(ui), /said\.textContent = 'Saved\.'; said\.classList\.remove\('bad'\);/.test(ui),
    /\.rp-said\.bad \{ color: var\(--red, #[0-9a-f]{6}\); \}/.test(src('../src/report.css'))], [true, true, true]);

// ---------- card 534's Sprint ----------
// The raw data holds the Japanese スプリント in the English field; the override
// is the only thing keeping it off every screen, so it is pinned by name.
const overrides = JSON.parse(src('../../data/name_overrides.json'));
check('534_A reads Sprint', overrides.actions?.['534_A']?.en, 'Sprint');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
