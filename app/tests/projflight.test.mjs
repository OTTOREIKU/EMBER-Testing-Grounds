// A PROJECTILE FLIES ACROSS THE BOARD, AND ITS ATTACK WAITS FOR IT TO LAND.
//
// OTTO, 2026-10-05: "when watching CPU play or when using missiles and other
// projectiles if they are in range to attack/detonate there is no animation for
// them moving they just begin combat ... the missile will move in a path
// towards the unit and then the combat popup will happen ... This new movement
// animation would apply to any projectiles or deployable or anything that is
// fired away from a unit."
//
// Two flights. A launch: what was launched is a new token, drawn where it
// lands, and flown there from the middle of the unit that fired it. A flight at
// a target: a Guided Projectile (and a Pholcus jumping) moves into its target's
// Grid on the table (`flyToTarget`), walked there in a straight line. An attack
// made with a Projectile in flight, or on one, opens its window as it lands.
//
// Driven, not read, where it can be: matchhud.ts's real flight code is cut out
// and run on a stub board whose walks end when the test says. The pages' wiring
// is read.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Projectile flies, and its attack waits for it to land\n');

const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  if (s.indexOf(a, i + 1) >= 0) throw new Error(`${what}: start marker is not unique`);
  return s.slice(i, j);
};
const srcOf = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const boardSrc = srcOf('board.ts');
const hudSrc = srcOf('matchhud.ts');
const matchSrc = srcOf('match.ts');
const mainSrc = srcOf('main.ts');

// ---------- the straight line ----------
const stopsSrc = cut(boardSrc, 'export function straightStops(', '// The cells a base covers', 'straightStops');
// ---------- the HUD's walks and flights, on a stub board ----------
const flightSrc = cut(hudSrc, 'export function animateRemoteMove(', '// ---------- launching a Projectile', 'the walks and flights');
const slice = new URL('./_projflight.hud.slice.ts', import.meta.url);
writeFileSync(slice, `${stopsSrc}
let animatingUid: number | null = null;
export const walks: { uid: number; stops: { col: number; row: number }[]; done: () => void }[] = [];
export const drawn: string[] = [];
let board: any = { animateMove(uid: number, stops: { col: number; row: number }[], done: () => void) { walks.push({ uid, stops, done }); } };
let hudRef: any = {};
// What renderBoard does about flights: the token layer held while one walks,
// then the next flight started (matchhud.ts renderBoard).
function renderBoard(_ctx: any): void { drawn.push(animatingUid === null ? 'tokens' : 'held'); nextFlight(); }
${flightSrc}`);
const H = await import(`${slice.href}?v=${Date.now()}`);

check('a straight flight has one stop for each Large Grid it crosses, from where it starts to where it lands',
  [H.straightStops({ col: 0, row: 0 }, { col: 9, row: 0 }), H.straightStops({ col: 0, row: 0 }, { col: 1, row: 1 }).length],
  [[{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 6, row: 0 }, { col: 9, row: 0 }], 2]);

// A launch: queued, started once the board has drawn the new token.
{
  H.queueFlight(7, { col: 3, row: 3 }, { col: 9, row: 3 });
  check('A LAUNCH FLIES: queued, the board is drawn, and the flight starts from the launcher to where the Projectile landed',
    [H.walks.length, H.walks[0]?.uid, H.walks[0]?.stops.at(0), H.walks[0]?.stops.at(-1)], [1, 7, { col: 3, row: 3 }, { col: 9, row: 3 }]);
  check('while it flies the computer waits (walking) and the Projectile is in motion', [H.walking(), H.inMotion(7), H.inMotion(8)], [true, true, false]);
  const opened = [];
  H.whenStill(7, () => opened.push('window'));
  H.whenStill(8, () => opened.push('other'));
  check('an attack on it waits for it to land; one on a unit standing still opens at once', opened, ['other']);
  H.walks[0].done();
  check('as it lands the attack opens, once, and nothing is still walking', [opened, H.walking(), H.inMotion(7)], [['other', 'window'], false, false]);
  H.walks[0].done();
  check('a walk ending twice opens nothing more', opened, ['other', 'window']);
}

// Two launches in a row (a Volley): one at a time.
{
  H.walks.length = 0;
  H.queueFlight(11, { col: 0, row: 0 }, { col: 3, row: 0 });
  H.queueFlight(12, { col: 0, row: 0 }, { col: 6, row: 0 });
  check('two Projectiles launched together fly one after the other', [H.walks.map((w) => w.uid), H.inMotion(12)], [[11], true]);
  H.walks[0].done();
  check('the second flies as the first lands', H.walks.map((w) => w.uid), [11, 12]);
  H.walks[1].done();
  check('and then nothing is in flight', H.walking(), false);
}

// A flight at a target: walked as any move is, the window waiting on it.
{
  H.walks.length = 0;
  const order = [];
  H.animateRemoteMove(7, { col: 9, row: 3 }, { col: 9, row: 12 }, H.straightStops({ col: 9, row: 3 }, { col: 9, row: 12 }).slice(1), () => order.push('drawn again'));
  H.whenStill(7, () => order.push('window'));
  check('A PROJECTILE FLYING AT ITS TARGET is walked there in a straight line, and the window waits', [H.walks[0]?.uid, H.walks[0]?.stops.length, order, H.walking()], [7, 4, [], true]);
  H.walks[0].done();
  check('it lands, the page is drawn again, and then the window opens', [order, H.walking()], [['drawn again', 'window'], false]);
  const now = [];
  H.animateRemoteMove(7, { col: 9, row: 12 }, { col: 9, row: 12 }, undefined, () => now.push('done'));
  check('a flight to where it already stands is no flight: done at once', [now, H.walks.length], [['done'], 1]);
}

// ---------- the pages' wiring ----------
check('the Match Centre draws the token layer and then starts the next flight',
  /if \(animatingUid === null\) board\.renderTokens\(s, preview\);\n\s*nextFlight\(\);/.test(hudSrc), true);
check('THE MATCH CENTRE: a command of its own and one from the other seat each fly a launch and a flight at a target',
  [/const fly = flyStart\(cmd\);\n\s*const v = perform\(data, state, cmd\);/.test(matchSrc), /offerCoordinationAfterManeuver\(cmd\);\n\s*flyMove\(fly\);\n/.test(matchSrc),
    /const start = moveStart\(cmd\);\n\s*const fly = flyStart\(cmd\);\n\s*const verdict = applyRemote\(data, state, cmd\);/.test(matchSrc), /walkMove\(cmd, start\);\n\s*flyMove\(fly\);\n/.test(matchSrc)],
  [true, true, true, true]);
check('a launch flies EVERY unit it put down (a Missile Group puts down several) from the middle of the unit that fired it, and the page is drawn again as each lands',
  [/if \(cmd\.kind === 'launch'\) return \{ launcher: cmd\.uid, before: new Set\(state\.tokens\.map\(\(t\) => t\.uid\)\) \};/.test(matchSrc),
    /for \(const shot of state\.tokens\.filter\(\(t\) => !start\.before\.has\(t\.uid\) && t\.parentUid === start\.launcher\)\) \{/.test(matchSrc),
    /queueFlight\(shot\.uid, \{ col: \(from\.col \?\? 0\) \+ inset, row: \(from\.row \?\? 0\) \+ inset \}, \{ col: shot\.col \?\? 0, row: shot\.row \?\? 0 \}, \(\) => render\(\)\);/.test(matchSrc)],
  [true, true, true]);
check('an attack of its own with a Projectile in flight, or on one, opens as it lands; the other seat\'s attack is drawn once it has',
  [/const flying = inFlight\(uid, targetUid\);\n\s*if \(flying !== undefined\) \{\n\s*whenStill\(flying, \(\) => startAttack\(uid, actionId, targetUid, mode, opts\)\);\n\s*return;/.test(matchSrc),
    /if \(inFlight\(at\.uid, df\.uid\) !== undefined\) \{\n\s*attackHelper\.closeMirror\(\);\n\s*return false;/.test(matchSrc)],
  [true, true]);
check('THE TABLETOP: a launch flies from the launcher, and a Detonation\'s flight or jump is walked before its window opens',
  [/for \(const shot of state\.tokens\.slice\(before\)\) \{\n\s*const inset = Math\.max\(0, Math\.floor\(\(t\.size - shot\.size\) \/ 2\)\);\n\s*board\.animateMove\(shot\.uid, straightStops\(/.test(mainSrc),
    /board\.animateMove\(proj\.uid, straightStops\(flewFrom, \{ col: now\.col, row: now\.row \}\), then\);/.test(mainSrc),
    /fly\(\(\) => \{\n\s*attackHelper\.start\(proj, action, target, 'Explosion damage: no line of sight or facing check\.', 0, '', true\);/.test(mainSrc)],
  [true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
