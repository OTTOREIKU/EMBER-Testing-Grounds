// The notice line on each page (OTTO's picks, 2026-09-28; notices.test.mjs
// covers the component itself). Read as source: each check is one page's glue.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

console.log('Notice line on each page\n');

// ---------- the pad ----------
const pad = src('../pad/pad.ts');
check('pad: the line lives above the dock, where the toast stack was',
  [pad.includes('<div class="pad-notice" id="pad-notice" hidden></div>'), pad.includes('id="pad-toasts"')], [true, false]);
check('pad: terse, with the pad\'s own Undo, and a long press explains a greyed control',
  /configureNotices\(\{ host: \(\) => document\.getElementById\('pad-notice'\), voice: 'terse', onUndo: \(\) => undo\(\) \}\);\s*explainOnHold\(root\);/.test(pad), true);
check('pad: every message goes through toast(text, kind), and a confirmation is the silent default',
  /function toast\(text: string, kind: NoticeKind = 'done', undoable = false\): void \{\s*notify\(/.test(pad), true);
check('pad: the red banner is left to the sign-in screens (no table refusal writes it)',
  [/error = verdict\.why/.test(pad), /error = v\.why/.test(pad), /querySelector\('\.pad-err'\)\?\.scrollIntoView/.test(pad)], [false, false, false]);

// ---------- the Match Centre ----------
const match = src('../src/match.ts');
const hud = src('../src/matchhud.ts');
check('Match Centre: the line lives at the bottom of the board, not in a red box atop the turn panel',
  [hud.includes('<div id="mc-notice" class="mc-notice" hidden></div>'), /class="mc-err"[^\n]*ctx\.note/.test(hud)], [true, false]);
check('Match Centre: terse, and a long press explains a greyed row',
  /configureNotices\(\{ host: \(\) => document\.getElementById\('mc-notice'\), voice: 'terse' \}\);\s*explainOnHold\(document\.body\);/.test(match), true);
check('Match Centre: while the match is on screen every message goes to the line; anywhere else (a room\'s lobby too) the lobby keeps its own',
  /function say\(kind: NoticeKind, text: string \| null \| undefined\): void \{\s*if \(!text\) return;\s*if \(hudUp\(\)\) notify\(\{ kind, text \}\);\s*else \{ lobbyNote = text; render\(\); \}/.test(match) && /const hud = hudUp\(\);/.test(match), true);
check('Match Centre: nothing writes the old note directly any more, except to clear it',
  [...match.matchAll(/lobbyNote = ([^;\n]+)/g)].map((m) => m[1]).filter((v) => v !== 'null' && v !== 'text'), []);
check('Match Centre: the HUD\'s notes say what kind they are, and refuse by default',
  [/noteNow: \(text, kind\) => say\(kind \?\? 'refused', text\),/.test(match),
    (hud.match(/, 'done'\)/g) ?? []).length >= 60, (hud.match(/, 'table'\)/g) ?? []).length >= 6, (hud.match(/, 'system'\)/g) ?? []).length >= 5],
  [true, true, true, true]);
check('Match Centre: each player hears what the other did to their units or the table (pick 3)',
  // Wider since P7A: the other player's Charge and Discard are said first (audit Phase 7).
  /const TABLE_WIDE = new Set\(\[[^\]]*\]\);[\s\S]{0,1500}if \(!TABLE_WIDE\.has\(cmd\.kind\) && !\(target && target\.side === mySeat\(\)\)\) return;[\s\S]{0,200}if \(meta\.role === 'quiet'\) return;\s*say\('event', meta\.label\);/.test(match), true);
check('Match Centre: a refused row is greyed, silent on a press, and says why on hover or a long press (pick 6)',
  // Eleven since P7A: the Charge's and the Discard's refused Parts (audit Phase 7).
  // Seventeen since P7D: the six list rows that were truly disabled (P7D 9).
  [(hud.match(/` aria-disabled="true" data-why="/g) ?? []).length, (hud.match(/` data-why="/g) ?? []).length], [17, 0]);
check('Match Centre: a refused row carries no title, so its reason is said once, in the line (pick 2)',
  [/data-why="\$\{esc\([^\n]*?\)\}" title=/.test(hud), /title="\$\{esc\(\w+\.ok\s*\?/.test(hud), /\.why \?\? ''\)\}"(?!`)/.test(hud.replace(/data-why="\$\{esc\(\w+\.why \?\? ''\)\}"/g, ''))],
  [false, false, false]);
check('Match Centre: no greyed row is also truly disabled (that hears no hover and no hold)',
  /\$\{\w+ \? ' disabled' : ''\}[^\n]*aria-disabled/.test(hud), false);

// ---------- the tabletop ----------
const main = src('../src/main.ts');
const page = src('../table/index.html');
const guide = src('../src/playguide.ts');
const panel = src('../src/panel.ts');
const combat = src('../src/combat.ts');
check('tabletop: the line is stacked in the shortcut bar, above the keys, at the bottom centre of the board',
  /<div id="hintbar">\s*<div id="tt-notice" hidden><\/div>/.test(page), true);
check('tabletop: Teaching keeps its rule numbers, the sandbox and a strict or online game do not (pick 4), and Undo is the page\'s own',
  /configureNotices\(\{\s*host: \(\) => document\.getElementById\('tt-notice'\),\s*voice: \(\) => \(normaliseSetup\(state\.setup\) && !strictNow\(state\) \? 'teaching' : 'terse'\),\s*onUndo: \(\) => undoMove\(\),\s*\}\);\s*\/\/[^\n]*\n\s*explainOnHold\(document\.body\);/.test(main), true);
check('tabletop: a strict refusal goes to the line and leaves the hint (the instruction) alone',
  [/onRefused\(\(why\) => \{[^}]*say\('refused', why\);/.test(main), /setHint\(why\)/.test(main), /setHint\(v\.ok/.test(main), /setHint\(v\.why/.test(main)],
  [true, false, false, false]);
const alerts = [...main.matchAll(/alertDialog\(\{\s*title: ([^\n]+)/g)].map((m) => m[1].trim());
check('tabletop: the only modal alerts left are the game result, the dial mismatch and the two lists',
  [alerts.length, alerts.filter((a) => /wins|A draw|do not match|collection|were skipped/.test(a)).length], [5, 5]);
check('tabletop: no "anyway" dialog is left; freeplay and Teaching do it, warn and offer Undo (pick 5)',
  ['Attack it anyway', 'Open it anyway', 'Intercept anyway', 'Attack anyway (house rule)', 'Keep it hidden (house rule)',
    'Skip it (house rule)', 'Leave it (house rule)', "cancelLabel: 'Stop here'", "confirmLabel: 'Force the move'", "confirmLabel: 'Play it'"]
    .filter((label) => main.includes(label)), []);
check('tabletop: a strict table refuses a target and keeps the targeting open; the rest make the attack and say what they bent',
  [/if \(problem && strictNow\(state\)\) \{\s*say\('refused', `\$\{problem\} Pick another target, or press Esc\.`\);\s*return;\s*\}\s*const mark = boardMark\(\);\s*endTargeting\(\);/.test(main),
    /if \(problem\) \{\s*bentRule\(problem, mark,/.test(main)],
  [true, true]);
check('tabletop: a house rule\'s Undo lasts only while that same window is open with nothing rolled or done since, and never online',
  [/const last = snapshotBack\(0\)\?\.seq;\s*notify\(\{\s*kind: 'warn',\s*text: `\$\{why\} Made anyway, as a house rule\.`,\s*undo: session \? \(\) => !getLocalSeat\(\) && open\(\) === session && snapshotBack\(0\)\?\.seq === last : undefined,/.test(main),
    /return \(\) => !getLocalSeat\(\) && seq !== undefined && snapshotBack\(0\)\?\.seq === seq;/.test(main),
    /get unrolled\(\): object \| null \{\s*const c = this\.ctx;\s*if \(!c \|\| this\.mirroring \|\| c\.attackRoll \|\| c\.defenseRoll \|\| c\.blackResult\) return null;/.test(combat),
    /abandon\(\): void \{\s*this\.ctx = null;\s*this\.onClose\(\);\s*\}/.test(combat)],
  [true, true, true, true]);
check('tabletop: the guide greys what a strict table refuses, and nothing in it is disabled with only a title to explain',
  [/function greyed\(why: string\): string \{\s*return ` aria-disabled="true" data-why="\$\{esc\(why\)\}"`;/.test(guide),
    // The End Phase's waiting fieldset keeps its title: its reason is printed
    // beside it as well, so nothing is hidden there.
    // An Action with nothing to do (r.idle) is greyed on every table too.
    /\$\{why && \(r\.idle \|\| strict\) \? greyed\(why\) :/.test(guide), guide.split('\n').filter((l) => /disabled title=/.test(l) && !/<fieldset/.test(l)).length],
  [true, true, 0]);
check('tabletop: the Details pips a table will not correct by hand, and a Shove with nothing in front, are greyed with the reason',
  [/blockedWhy\?\(t: Token, what: 'restoreAmmo' \| 'restoreIntercept' \| 'charge' \| 'shove' \| 'support', actionId: string\): string \| null;/.test(panel),
    /data-reload="\$\{a\.id\}"\$\{greyAttrs\(ammoWhy\)\}/.test(panel), /const shoveWhy = this\.cb\.blockedWhy\?\.\(t, 'shove', a\.id\)/.test(panel),
    /blockedWhy\(t, what, actionId\) \{/.test(main), /blockedWhy: \(t, what, actionId\) => \{[\s\S]{0,700}if \(!relay\.state\.room\) return null;/.test(match)],
  [true, true, true, true, true]);
check('tabletop: the toolbar Undo is greyed with nothing to take back, and names what it takes otherwise',
  [/syncSquadTints\(\);\s*syncUndoButton\(\);/.test(main), /b\.dataset\.why = 'Nothing left to undo\.';/.test(main)], [true, true]);

// ---------- smoke on the table marks its units (OTTO, 2026-09-29) ----------
check('pad: after a Smoke Screen is placed, one popup marks every unit now in smoke',
  [/toast\(`\$\{proj\.label\}: \$\{smoke\.count\} Smoke Screen[\s\S]{0,260}await askInSmoke\(proj\.uid\);\s*nextDetonation\(\);/.test(pad),
    /title: 'Are any units now in smoke\?',/.test(pad), /confirmLabel: 'Mark In smoke',\s*cancelLabel: 'None are',/.test(pad),
    /statusCount\(u\.statuses, 'smoke'\) === 0/.test(pad),
    /send\(\{ kind: 'applyStatus', \.\.\.sourceFor\(u\), targetUid: u\.uid, statusId: 'smoke', chain: 'join' \}\);/.test(pad)],
  [true, true, true, true, true]);

// ---------- no rule numbers in play (pick 4, OTTO 2026-09-29) ----------
check('play pages read their drawn text in the line\'s voice, the Reference\'s own sheets kept',
  [/speakInPlace\(document\.body, \{ keep: '#ref-detail, \.pad-find, \.ref-mech' \}\);/.test(pad),
    /speakInPlace\(document\.body, \{ keep: '#card-tip, \.ref-mech', active: \(\) => !\(normaliseSetup\(state\.setup\) && !strictNow\(state\)\) \}\);/.test(main),
    /speakInPlace\(document\.body, \{ keep: '#card-tip, \.ref-mech' \}\);/.test(match)],
  [true, true, true]);

// ---------- the pad's attack: declared in one panel (OTTO, 2026-09-29) ----------
check('pad attack: the dialogs before the dice are gone, one declaration panel asks what they asked',
  [['Shock Attack ${shock}`,\n      body', "title: 'Arc',", "title: 'Grace Note',", "title: 'Stationary',", "title: 'Low Profile',",
    'title: `[Two-Handed]: ${hands.label}`', 'title: `${a!.name.en}: Charge`', "label: 'In range', primary: true",
    "label: 'In range, a line clear of smoke', primary: true", "{ id: 'scan', label: 'Scan it', primary: true }",
    "label: 'Keep it hidden (house rule)'"].filter((x) => pad.includes(x)),
    ['shock', 'sight', 'rear', 'grace', 'still', 'lowprof', 'hands', 'charge'].filter((k) => !pad.includes(`key: '${k}'`))],
  [[], []]);
check('pad attack: the shot\'s "outside the arc" and "Melee Locked" answers are gone (they only refused the pick)',
  [/Outside \$\{attacker\.label\}'s Forward Arc/.test(pad), /is Melee Locked` \}\]/.test(pad)], [false, false]);
check('pad attack: every answer starts at what its dialog led with, and a Shock walk rules out "not moved"',
  [/const want = d\.answers\[row\.key\] \?\? row\.options\[0\]\.id;/.test(pad),
    /grey: walked \? \{ still: 'The Shock walk was Movement\.' \} : undefined,/.test(pad)],
  [true, true]);
// Review, 2026-09-29: the Shock dialog led with the walk, and an unanswered row
// must not pay a Stationary bonus; "walked" is the answer in force, not a tap.
check('review: the Shock row leads with the walk, and Stationary greys by the answer in force',
  [/key: 'shock', label: `Shock Attack \$\{shock\}`, options: \[\{ id: 'moved'/.test(pad),
    /const walked = rows\[0\]\?\.key === 'shock' && declared\(rows\[0\], d\) === 'moved';/.test(pad)],
  [true, true]);
check('review: a declaration answers only the request that opened it, and a reset table drops it',
  [/if \(declaring && declaring\.req !== targetFor\) declaring = null;/.test(pad),
    /if \(d\.req !== targetFor\) \{ declaring = null; render\(\); return; \}/.test(pad),
    /panel = null;\s*targetFor = null;\s*declaring = null;\s*looks = \[\];/.test(pad)],
  [true, true, true]);
check('review: a Scan first, an Electronic Attack and an Interception stop on the panel, one tap from the roll',
  [/const kind: DeclareKind = req\.mode === 'intercept' \? 'intercept' : req\.mode === 'electronic' \? 'electronic' : scan \? 'scan' : 'attack';/.test(pad),
    /case 'pick-target': \{[\s\S]{0,300}pickTarget\(targetFor, t, d\);/.test(pad),
    /void askTableAndIntercept\(t, actionId, d\)|void askTableAndElectronic\(t, actionId, d\)/.test(pad)],
  [true, true, false]);
// Superseded the same day by the table's In reach record (aurareach.test.mjs):
// the aura is read off the record and named in the line, which keeps its Undo.
check('review: an aura taking Silence is read off the table\'s record, and one line says both losses',
  [/const aura = actionSilenceDenier\(data!, table\.tokens, now, a\);\s*loseSilence\(now, a, aura \? /.test(pad),
    /\$\{shed \? ', and its Low Profile Token comes off' : ''\}/.test(pad)],
  [true, true]);
check('review: the pad\'s Overwatch keeps its own checks where the shared reading defers to a board',
  /\?\? \(!foes\.length \? 'No enemy is on the table\.' : !mechs\.length \? 'No Ally Mech can fire\.' : null\);/.test(pad), true);
check('pad attack: a camouflaged target is tagged "Scan first" and the pick starts the Scan; smoke greys an Interception',
  [/\$\{scan \? 'Scan first' : esc\(KIND_LABEL\[u\.kind\]\)\}/.test(pad), /if \(d\.kind === 'scan'\) \{ void scanFirst\(attacker, d\.actionId, defender\); return; \}/.test(pad),
    /greyWhy\(!!smoke, smoke \?\? ''\)/.test(pad)],
  [true, true, true]);
check('pad attack: a non-Silent attack breaks camouflage at once, and Undo is the house rule',
  /if \(send\(\{ kind: 'reveal', seat: now\.side, uid: now\.uid \}\)\) \{\s*toast\([^;]*'table', true\);/.test(pad), true);
check('pad attack: the Two-Handed row says what both hands gain, the reach follows the answer, the smoke line has no rule number',
  [/key: 'hands', label: 'Two-Handed', note: `\$\{hands\.note\.replace\(/.test(pad),
    /declared\(handsRow, d\) === 'both'\s*\? twoHandedUse\(data!, t, printed, boxHands\(table\.tasks, t\.uid\)\)\?\.action \?\? printed/.test(pad),
    /no line of sight for a Firing Action \(4\.16\)/.test(pad)],
  [true, true, false]);
check('pad target list: enemies on the table but none to pick is not "No enemy unit on the table"',
  /'No enemy unit on the table can be picked for this\.' : 'No enemy unit on the table\.'/.test(pad), true);

// ---------- the review of the tabletop build (2026-09-28) ----------
check('review: the Reveal\'s Undo is offered only while the Reveal is the newest step, and never talks over a live Undo',
  [/const alone = !!newest && newest\.label === 'reveal' && \(snapshotBack\(1\)\?\.seq \?\? -1\) <= before;/.test(main),
    /if \(ok && !currentNotice\(\)\?\.undo\) say\('event', /.test(main)], [true, true]);
check('review: a tactic\'s Undo is caught before the redraw can Reveal someone',
  /const undoCard = whileNewest\(\);\s*renderUnitLog\(\);\s*selectToken\(target\.uid\);\s*onChanged\(\);/.test(main), true);
check('review: an Undo never drops a unit back into the Abyss, and the fall\'s own Undo is caught at the despawn',
  [/if \(envCardAt\(state, g\.c, g\.r\) === 'abyss'\) abyssSeen\.add\(t\.uid\);/.test(main),
    /const v = perform\(data, state, \{ kind: 'despawn', seat: still\.side, uid: still\.uid, targetUid: still\.uid \}\);\s*const undo = v\.ok && !strictNow\(state\) \? whileNewest\(\) : undefined;/.test(main)],
  [true, true]);
check('review: a blast a sweep sets off waits for the combat panel to be free, and the idle panel lets it go',
  [(main.match(/queueMicrotask\(\(\) => startDetonation/g) ?? []).length, (main.match(/startBlastWhenFree\(\w+\.uid, next\.actionId\);/g) ?? []).length,
    /class="dim combat-idle"[\s\S]{0,300}queueMicrotask\(releaseHeldBlast\);/.test(main),
    /if \(!heldBlasts\.length \|\| combatBusy\(\) \|\| launching \|\| smokePlacing\) return;/.test(main)],
  [0, 3, true, true]);
check('review: an Interception closed before any roll is "stop here" off a strict table',
  [/if \(attackHelper\.closedUnrolled && !strictNow\(state\)\) \{\s*openImmediateSurvivor\(\);\s*return;\s*\}/.test(main),
    /this\.closedUnrolled = this\.unrolled !== null;/.test(combat)], [true, true]);
check('review: the failed attack\'s Tick is spent before the house rule, so Undo leaves the rules\' outcome',
  /s\.done\?\.\(true\);\s*const mark = boardMark\(\);\s*go\(true\);/.test(main), true);
check('review: only a window this call opened is the Interception\'s',
  [/attackHelper\.unrolled && attackHelper\.unrolled !== before/.test(main), /if \(!session \|\| session === before\) return;/.test(main)], [true, true]);
check('review: the Charge goes back to the token the rewind restored',
  /const back = state\.tokens\.find\(\(x\) => x\.uid === attacker\.uid\);\s*if \(!refund \|\| !back\) return;/.test(main), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
