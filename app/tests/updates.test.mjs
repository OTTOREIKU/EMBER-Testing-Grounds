// THE "NEW VERSION" NOTICE (src/updates.ts), one component on every page since
// the 2026-09-24 audit. The pages differ only in WHERE it sits and WHEN it may
// show, and the WHEN is the part that matters: a reload in a live multiplayer
// game drops a player out of it. These pins keep each page's placement and gate
// as OTTO chose them.
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const upd = read('../src/updates.ts');
const landing = read('../src/landing.ts');
const reference = read('../src/reference.ts');
const pad = read('../pad/pad.ts');
const board = read('../src/main.ts');
const match = read('../src/match.ts');

console.log('The update notice: where it sits and when it may show\n');

// ---------- the component ----------
check('a gate that turns false takes a notice already up away',
  /const allowed = !!pending && \(options\.when\?\.\(\) \?\? true\);\s*if \(!allowed\) \{\s*current\?\.remove\(\);/.test(upd), true);
check('Later remembers the build it dismissed', upd.includes('localStorage.setItem(DISMISS_KEY, pending)'), true);
check('a dismissed build is not offered again', upd.includes('!dismissed(live)'), true);
check('Reload clears the caches before reloading', /caches\.delete\(n\)[\s\S]*location\.reload\(\)/.test(upd), true);

// ---------- every page is wired, each in its own place ----------
check('landing: wired, as the status line\'s right end',
  landing.includes('watchForUpdates({') && landing.includes('compact: true') && landing.includes(".land-status span:last-child')?.replaceWith(notice)"), true);
check('reference: wired, floating', /watchForUpdates\(\);/.test(reference), true);
check('pad: in the front door\'s status line, screens before a table only',
  pad.includes("when: () => screen !== 'table'") && pad.includes(".pad-sysline span:last-child')?.replaceWith(notice)"), true);
check('pad: re-placed or taken away after every render', /function render\(\): void \{[\s\S]{0,200}queueMicrotask\(syncUpdateNotice\)/.test(pad), true);
check('tabletop: above the inspector', board.includes("getElementById('inspect-box')") && board.includes("className: 'upd-rail'"), true);
check('tabletop: never in a multiplayer room', /watchForUpdates\(\{\s*[\s\S]{0,300}when: \(\) => !relay\.state\.room/.test(board), true);
check('tabletop: joining a room takes it away', /onChange\(view\) \{[\s\S]{0,150}syncUpdateNotice\(\);/.test(board), true);
check('match centre: in the front door\'s status line', match.includes(".mc-sysline span:last-child')?.replaceWith(notice)"), true);
check('match centre: never once a room is joined', /watchForUpdates\(\{\s*when: \(\) => !relay\.state\.room/.test(match), true);
check('match centre: re-placed or taken away after every render', /function render\(\): void \{[\s\S]{0,200}queueMicrotask\(syncUpdateNotice\)/.test(match), true);

// ---------- nothing test-only left behind ----------
// The dev server has no version.json; a hand-made one in public/ would ship and
// pin every visitor to a fake build.
check('no version.json sits in public/', existsSync(new URL('../public/version.json', import.meta.url)), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
