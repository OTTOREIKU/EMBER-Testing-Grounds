// Bug reports, and the black box they carry.
//
// The whole feature exists because a player who hits a deadlock cannot describe
// it. "I couldn't end my turn" narrows nothing; the board does. So the tests
// that matter here are about what SURVIVES into the file:
//
//   - the board, frozen, so it cannot change under the report
//   - the board from five moves back, so the PATH is there and not just the
//     dead end
//   - labels from the history ring and never its snapshots, which are whole
//     boards and would turn an 8KB report into megabytes
//   - nothing from the credential path, ever
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

// diagnostics.ts imports nothing at all, by design: the net that catches
// failures must not be breakable by what it watches.
const dtmp = new URL('./_diagnostics.slice.ts', import.meta.url);
writeFileSync(dtmp, src('diagnostics.ts'));
const D = await import(dtmp.href);

// history.ts imports only types, so stripping imports leaves it standalone.
const htmp = new URL('./_reporthistory.slice.ts', import.meta.url);
writeFileSync(htmp, 'type GameState = any;\n' + src('history.ts').replace(/^import[^\n]*\n/gm, ''));
const H = await import(htmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

// ---------- the black box ----------

console.log('\nthe error ring');

D.clearDiagnostics();
check('starts empty', [D.diagErrors().length, D.diagRefusals().length], [0, 0]);

D.noteError('boom');
check('an error lands', D.diagErrors().length, 1);
check('with a wall clock, because a report is read days later',
  /^\d{4}-\d{2}-\d{2}T/.test(D.diagErrors()[0].at), true);
check('and no command blamed when none was running', D.diagErrors()[0].during, undefined);

// THE POINT OF THE WHOLE RING: an error is worth ten times as much when it
// names the move that caused it.
D.noteCommand('maneuver');
D.noteError('TypeError: cannot read x');
check('an error during a command names it', D.diagErrors()[1].during, 'maneuver');
D.noteRefusal('That unit has already acted.');
check('so does a refusal', D.diagRefusals()[0].during, 'maneuver');
check('and the refusal keeps the engine\'s own words',
  D.diagRefusals()[0].what, 'That unit has already acted.');
D.noteCommand(null);
D.noteError('later');
check('and clearing the command stops blaming it', D.diagErrors()[2].during, undefined);

// SELF-EXPIRING. The first wiring set the command and never cleared it, so an
// error thrown an hour into an idle session was still blamed on the last move
// -- false attribution in the one field that makes the ring worth having.
// apply() is synchronous, so its errors land before the task's microtasks run;
// anything after that is not the command's doing.
D.noteCommand('advancePhase');
await Promise.resolve();
D.noteError('idle-time error');
check('the blame expires with the task', D.diagErrors().at(-1).during, undefined);
D.noteCommand('first');
D.noteCommand('second');
await Promise.resolve();
check('and a superseded command cannot clear its successor early',
  D.diagInFlight(), null);

// Bounded, or a long game with a repeating fault evicts the FIRST error, which
// is usually the one that explains the rest.
D.clearDiagnostics();
for (let i = 0; i < 60; i++) D.noteError(`e${i}`);
check('the ring is capped', D.diagErrors().length, 20);
check('and keeps the most recent', D.diagErrors().at(-1).what, 'e59');

// A bundled stack runs to tens of kilobytes of framework frames; the answer is
// at the top.
D.clearDiagnostics();
D.noteError('big', { stack: 'x'.repeat(5000) });
ok('a huge stack is trimmed', D.diagErrors()[0].stack.length < 1700);
ok('and says that it was', /truncated/.test(D.diagErrors()[0].stack));
D.noteError('nostack', { stack: 42 });
check('a non-string stack is dropped rather than stringified',
  D.diagErrors()[1].stack, undefined);

// Snapshots, not live arrays: a caller must not be able to edit the ring.
D.clearDiagnostics();
D.noteError('one');
D.diagErrors().push({ at: 'x', what: 'injected' });
check('the ring hands out a copy', D.diagErrors().length, 1);

console.log('\ninstalling the net');

const fake = () => {
  const on = {};
  return {
    on,
    addEventListener(type, fn, capture) { (on[type] ??= []).push({ fn, capture }); },
  };
};

D.clearDiagnostics();
let t1 = fake();
D.installDiagnostics(t1);
ok('it listens for uncaught errors', !!t1.on.error);
ok('and for rejected promises', !!t1.on.unhandledrejection);
// Capture, or an error inside a listener that stops propagation never arrives.
check('errors are caught in the capture phase', t1.on.error[0].capture, true);

t1.on.error[0].fn({ message: 'Boom', filename: 'x.ts', lineno: 4, colno: 9, error: { stack: 'at f' } });
check('an uncaught error is recorded', D.diagErrors().length, 1);
check('with where it happened', D.diagErrors()[0].where, 'x.ts:4:9');

// A FAILED <img> fires 'error' at the window with no message. The reference is
// a page of card portraits; letting those in would flush a ring of twenty in
// seconds and bury the real failure underneath missing art.
t1.on.error[0].fn({ message: '', target: {} });
check('a failed image is not an error', D.diagErrors().length, 1);

t1.on.unhandledrejection[0].fn({ reason: { message: 'nope', stack: 'at g' } });
check('a rejected promise is recorded', D.diagErrors().length, 2);
ok('and marked as one', /^Unhandled: /.test(D.diagErrors()[1].what));
t1.on.unhandledrejection[0].fn({ reason: 'a bare string' });
ok('a rejection with no Error still lands', /a bare string/.test(D.diagErrors()[2].what));
t1.on.unhandledrejection[0].fn({});
check('and one with nothing at all does too', D.diagErrors().length, 4);

// The handler must never be the thing that breaks the page it is watching.
t1.on.error[0].fn(null);
check('a malformed event is swallowed', D.diagErrors().length, 4);

// Both board pages and the reference each install on load.
const t2 = fake();
D.installDiagnostics(t2);
check('a second install is refused', t2.on.error, undefined);

// ---------- reading an old board without moving the game ----------

console.log('\nthe board five moves back');

H.clearHistory();
check('nothing to look back at yet', H.snapshotBack(0), null);

for (let i = 1; i <= 8; i++) {
  H.recordSnapshot({ round: { n: 1, phase: 0 }, mark: i }, `cmd${i}`, { human: `Step ${i}` });
}
// snapshotBack(0) is the board BEFORE the most recent command, so the fifth
// step back is index 4.
check('the most recent is the board before the last command',
  JSON.parse(H.snapshotBack(0).json).mark, 8);
check('and five back is five commands earlier',
  JSON.parse(H.snapshotBack(4).json).mark, 4);
check('past the end is null, not a throw', H.snapshotBack(99), null);
check('reading does not shorten the ring', H.historyDepth(), 8);

// undoTo APPLIES what it finds. A report must be able to read a position and
// leave the game exactly where it is.
const before = H.historyDepth();
H.snapshotBack(3);
check('and reading is not an undo', H.historyDepth(), before);

console.log('\nwhat rides along from the ring');

const entries = H.historyEntries();
ok('entries carry the human label', entries[0].human === 'Step 1');
// THE SIZE TRAP: every Snapshot holds `json`, a whole board. 160 of them is
// megabytes. historyEntries is what a report may carry, and it must not leak
// one.
check('and never the board JSON',
  entries.filter((e) => 'json' in e).length, 0);
// Listed exhaustively rather than spot-checked, so widening historyEntries
// has to come past this line and be a decision about what a report carries.
check('nor anything else unexpected',
  [...new Set(entries.flatMap((e) => Object.keys(e)))].sort(),
  ['human', 'inPlay', 'kind', 'phase', 'role', 'round', 'seat', 'seq'].sort());

// ---------- the report itself ----------

console.log('\nthe report');

const rep = src('report.ts');

ok('the board is copied, not referenced',
  /JSON\.parse\(JSON\.stringify\(o\.state\)\)/.test(rep));
ok('and the five-moves-back board is parsed out of the snapshot',
  /JSON\.parse\(back\.json\)/.test(rep));
// OFF the general path: 10KB nobody reads on a report about a typo.
ok('the old board rides only when asked for', /o\.includeBefore \? snapshotBack/.test(rep));
ok('and the recent list is sliced, not sent whole', /historyEntries\(\)\.slice\(-RECENT\)/.test(rep));
check('five moves back is what SNAPSHOT_BACK means',
  /SNAPSHOT_BACK = (\d+)/.exec(rep)[1], '5');
ok('and it is read one short, since index 0 is already one move back',
  /snapshotBack\(SNAPSHOT_BACK - 1\)/.test(rep));

const ui = src('reportui.ts');
ok('the old board is attached on the stuck path', /includeBefore: kind === 'stuck'/.test(ui));
ok('the manifest is rebuilt from the same call that saves',
  /const refresh = \(\): void => \{ man\.innerHTML = manifestHtml\(make\(\)\); \};/.test(ui));
// A stale manifest is worse than none: it tells somebody they are sending one
// thing while they send another.
ok('and rebuilt on every edit', /dlg\.addEventListener\('input', refresh\)/.test(ui));
ok('a click inside the panel does not throw the form away',
  /if \(ev\.target === dlg\) close\(\)/.test(ui));

ok('the filename has no colons, which Windows refuses',
  /replace\(\/\[-:\]\/g, ''\)/.test(rep));
ok('the blob url outlives the click, for Safari',
  /setTimeout\(\(\) => URL\.revokeObjectURL/.test(rep));
ok('and a blocked clipboard is reported rather than swallowed',
  /return false/.test(rep) && /Could not copy/.test(ui));

// ---------- nothing from the credential path ----------

console.log('\nwhat must never be in the box');

// The day somebody widens the capture is the day this happens by accident, so
// it is asserted rather than remembered.
for (const bad of ['csrf', 'password', 'X-CSRF-Token', 'cookie', 'credentials', 'localStorage']) {
  check(`the report never reaches for ${bad}`, rep.includes(bad), false);
}
ok('it does not import the api client at all', !/from '\.\/api'/.test(rep));
ok('nor does the form', !/from '\.\/api'/.test(ui));
// The UA string is the one browser fact worth having. Anything more is
// fingerprinting a player who is trying to do us a favour.
check('and it takes the user agent and nothing else about the device',
  (rep.match(/navigator\.\w+/g) ?? []).sort(), ['navigator.clipboard', 'navigator.userAgent']);

// ---------- reading a report back ----------

console.log('\nloading a report back');

// Save produced a file that Load refused: the report wraps the board in an
// envelope, and the importer fed the envelope itself to migrateState. The
// reports folder was a dead end you could only escape with a text editor.
const mainSrc = src('main.ts');
ok('the importer recognises the report envelope',
  /raw\.v === 1 && typeof raw\.type === 'string'/.test(mainSrc));
ok('and loads the board inside it', /picked = wrap\.state;/.test(mainSrc));
ok('a stuck report offers the board from before it broke',
  /wrap\.before\?\.state/.test(mainSrc) && /id: 'before'/.test(mainSrc));
// The offer has to DO something: a mutation test caught this assertion pinning
// the button's existence while the choice changed nothing.
ok('and choosing it loads that board, not the reported one',
  /if \(at === 'before'\) picked = wrap\.before\.state;/.test(mainSrc));
ok('cancelling loads neither', /if \(at !== 'now' && at !== 'before'\)/.test(mainSrc));
ok('a reference report is refused with its own words, not "not a board file"',
  /That is a reference report/.test(mainSrc));

console.log('\nwhere the buttons are');

const index = src('../index.html');
const refhtml = src('../reference.html');
ok('freeplay has one in the setup rail', /id="btn-report"/.test(index));
ok('the reference has one in its header', /id="ref-report"/.test(refhtml));
ok('the match centre has one in its bar', /id="mc-report"/.test(src('match.ts')));

// TWO DOORS on the reference, and this is why: the detail sheet is a modal over
// the whole page, so the header button is unreachable while a card is open and
// the card's own flag is unreachable while it is shut. Wiring only the header
// meant the card report could never actually name a card, which is the one
// field that makes it worth sending.
const ref = src('reference.ts');
ok('the reference has a report button on the card itself', /id="ref-detail-report"/.test(refhtml));
ok('and it sits in the card\'s own tool row',
  refhtml.indexOf('ref-detail-report') > refhtml.indexOf('ref-detail-tools'));
ok('both doors open the same report', (ref.match(/reportOpenCard/g) ?? []).length === 3);
ok('which reads what is open off the nav stack',
  /navStack\[navStack\.length - 1\]/.test(ref));

// EVERY KIND, not just cards. The sheet opens cards, keywords, Boxes and
// factions; reading only the card case meant opening a keyword and reporting it
// produced a report that named nothing at all.
console.log('\nwhat the reference can name');

for (const kind of ['card', 'keyword', 'box', 'faction']) {
  ok(`it can name a ${kind}`, new RegExp(`v\\.kind === '${kind}'|kind === '${kind}'`).test(ref)
    || kind === 'faction');   // faction is shownFor's fall-through
}
ok('and names it the way the page already does', /name: viewLabel\(open\)/.test(ref));
ok('carrying the sheet\'s own kind rather than a second vocabulary',
  /kind: open\.kind/.test(ref));
// Nested one level: a keyword keeps its text under en/zh/jp, and that text is
// the whole reason anyone reports one.
ok('a keyword\'s text survives the flattening', /Object\.assign\(out, flatten\(v, /.test(ref));
ok('but not deeper, so one bad row cannot dump a tree', /if \(prefix\) continue;/.test(ref));

// RULES HAVE NO SHEET. There is nothing to open, so the tab is the only signal
// -- and before the category existed there was no way to report one at all.
ok('a tab maps to a category when nothing is open', /TAB_CATEGORY\[tab\] \?\? 'other'/.test(ref));
check('and every tab has one',
  ['keywords', 'parts', 'units', 'pilots', 'tactics', 'boxes', 'factions', 'missions', 'rules']
    .filter((tb) => !new RegExp(`${tb}:`).test(ref.slice(ref.indexOf('TAB_CATEGORY')))), []);
ok('the rules tab reports a rule', /rules: 'rules'/.test(ref));

console.log('\nchoosing what is wrong');

ok('the form offers a category', /id="rp-cat"/.test(ui));
check('covering every kind the reference holds, plus a catch-all',
  /CATEGORIES: ReportCategory\[\] = \[([^\]]*)\]/.exec(ui)[1].replace(/['\s]/g, '').split(','),
  ['card', 'keyword', 'rules', 'mission', 'box', 'faction', 'other']);
// Picking a different category means the open subject is NOT what they mean.
ok('a changed category drops the auto-detected subject',
  /const subjectFits = \(\): boolean => !!o\.subject && chosen\(\) === o\.category;/.test(ui));
ok('and asks which one instead', /namesRow\.hidden = subjectFits\(\)/.test(ui));
ok('while the fields we show are dropped with it', /shown: subjectFits\(\) \? o\.shown : \{\}/.test(ui));
// "What does your card say" is the wrong question about a rule.
ok('the printed-source question follows the category',
  /printedLabel\.textContent = PRINTED_LABEL\[chosen\(\)\]/.test(ui));
ok('and the rulebook is asked about rules', /rules: 'What does the rulebook say\?'/.test(ui));

// Where they were reading. For a rules report with no subject this is often the
// only thing that narrows it down.
ok('the report carries the tab and the search box', /looking: \{ tab, search: query\.trim\(\) \}/.test(ref));

// SELF-CONTAINED CHROME. index.html and reference.html link no stylesheet at
// all -- their CSS arrives through the bundle -- and reference.ts imports
// reference.css WITHOUT styles.css. Borrowing .scn-panel and .dlg-close from
// styles.css left the reference page with an unstyled shell in the bottom-left
// corner, which is exactly how this was found.
const rcss = src('report.css');
ok('the report dialog styles its own overlay', /#report-dialog\s*\{/.test(rcss));
ok('and its own panel', /\.rp-panel\s*\{/.test(rcss));
ok('and its own close button', /\.rp-close\s*\{/.test(rcss));
ok('the close button is the circle the rest of the app uses',
  /border-radius: 50%/.test(rcss) && /width: 34px; height: 34px/.test(rcss));
ok('the markup borrows no class it does not own',
  !/scn-panel|dlg-close|inv-head/.test(ui));
ok('and styles.css no longer claims the report dialog',
  !/#report-dialog/.test(src('styles.css')));
// A shared component cannot assume a token exists: --radius-lg is defined in
// styles.css and match.css and NOT in reference.css.
check('every colour and size falls back when its token is missing',
  (rcss.match(/var\(--[a-z0-9-]+\)/g) ?? []), []);

// OTTO does not want em dashes in anything a player reads. Comments are prose
// for us and are left alone; these are the strings and the markup.
for (const [name, text] of [['the report form', ui], ['the report itself', rep],
  ['the freeplay page', index], ['the reference page', refhtml]]) {
  check(`no em dash in ${name}`, text.includes('\u2014'), false);
}

// Installed at the top of each entry module: a net installed after the thing it
// is meant to catch is not a net.
for (const f of ['main.ts', 'match.ts', 'reference.ts']) {
  const s = src(f);
  const at = s.indexOf('installDiagnostics(window)');
  ok(`${f} installs the black box`, at > 0);
  ok(`  and does it before anything else runs`,
    at < s.indexOf('addEventListener(\'click\''));
}

// The relay already assembles a connection report for the health pill. A second
// one would be a second thing to keep true.
ok('the match report reuses the relay\'s own connection report',
  /net: relay\.diagnostics\(\)/.test(src('match.ts')));
// Both taps, or a refusal reaches the player and not the report.
ok('freeplay records refusals as well as showing them', /noteRefusal\(why\);/.test(src('main.ts')));
ok('and so does the match centre', /noteRefusal\(why\);/.test(src('match.ts')));
ok('both name the command in flight', /noteCommand\(cmd\.kind\)/.test(src('main.ts'))
  && /noteCommand\(cmd\.kind\)/.test(src('match.ts')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
