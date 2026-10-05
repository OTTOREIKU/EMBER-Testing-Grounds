// The Season Rules in play (OTTO, 2026-09-30: "wire in the new seasonal
// mechanics to pad / the engine"; "a settings for enabling or disabling. In
// PAD this would be another button in the setup of the game").
//
// A table plays Season 1.04 only when its host turned it on at setup
// (configureTable `season`): Stabilize System becomes a Medium Action (2 Action
// Ticks) and 3 Smoke Screens leave each Connected group in the End Phase.
// Everything else, and every table without it, plays the main rules. Driven
// through the real engine and data, bundled.
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

console.log('Season Rules in play\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_seasonplay.entry.ts', import.meta.url);
const out = new URL('./_seasonplay.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { check, apply } from '../src/commands';",
  "export { newOpportunity, newScriptState } from '../src/types';",
  "export { migrateState } from '../src/units';",
  "export { dissipationFor } from '../src/rules';",
  "export { boardFingerprint } from '../src/secrecy';",
  "export { setLocalSeat } from '../src/loop';",
  "export { canPerform, costOf, lengthOf } from '../src/ticks';",
  "export * as S from '../src/season';",
  "export { glueAfter as hudGlueAfter } from '../src/matchhud';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const U = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await U.loadData();
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const stab = () => data.commonActions.find((a) => a.id === 'COMMON_STABILIZE');

// A table before its game starts, where setup may still change.
const table = (extra = {}) => ({
  v: 3, map: '', tokens: [], nextUid: 1,
  round: { n: 1, phase: 4, firstPlayer: 's1' },
  commandTokens: { s1: 0, s2: 0 },
  ...extra,
});

// ---------- the data says what each rule changes ----------
const season = data.seasons.find((s) => s.id === '1.04');
check('Season 1.04 carries its two effects', season.rules.map((r) => r.effect),
  [{ action: 'COMMON_STABILIZE', size: 'm' }, { smokePerGroup: 3 }]);

// ---------- the setting ----------
const t0 = table();
check('the host may turn a season on at setup, and back off', [U.check(data, t0, { kind: 'configureTable', seat: 's1', season: '1.04' }).ok,
  U.check(data, t0, { kind: 'configureTable', seat: 's1', season: null }).ok], [true, true]);
check('a season the data does not hold is refused', U.check(data, t0, { kind: 'configureTable', seat: 's1', season: '9.99' }).ok, false);
U.setLocalSeat('s2');
check('across a table only the host sets it', U.check(data, t0, { kind: 'configureTable', seat: 's2', season: '1.04' }).why,
  'Only the host sets the game length, the scale, the way it is played and its rules.');
U.setLocalSeat(null);
const running = table({ setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } } });
check('and it is fixed once the game is under way', U.check(data, running, { kind: 'configureTable', seat: 's1', season: '1.04' }).ok, false);
U.apply(data, t0, { kind: 'configureTable', seat: 's1', season: '1.04' });
check('applied, the table carries it', t0.season, '1.04');
U.apply(data, t0, { kind: 'configureTable', seat: 's1', season: null });
check('and turned off it carries nothing', 'season' in t0, false);

// It travels between players, so it is checked on arrival and hashed.
check('migrateState keeps a season id and drops anything else',
  [U.migrateState({ ...table(), season: '1.04' }, data).season, U.migrateState({ ...table(), season: '<b>x</b>' }, data).season, U.migrateState({ ...table(), season: 4 }, data).season],
  ['1.04', undefined, undefined]);
check('a drift in it is a desync the fingerprint sees',
  U.boardFingerprint(table({ season: '1.04' })) === U.boardFingerprint(table()), false);

// ---------- Stabilize System ----------
U.S.syncSeason(data, table());
check('on the main rules Stabilize System is Short: 1 Action Tick', [stab().size, U.lengthOf(stab()), U.costOf(stab())?.action], ['s', 'short', 1]);
U.S.syncSeason(data, table({ season: '1.04' }));
check('under Season 1.04 it is Medium: 2 Action Ticks', [stab().size, U.lengthOf(stab()), U.costOf(stab())?.action], ['m', 'medium', 2]);
// One Action Tick left, after a Short Starting Action at another Timing.
const opp = () => ({ ...U.newOpportunity(1, 'firing'), action: 1, started: true });
check('so it no longer follows a Short Action: refused with 1 Action Tick left', U.canPerform(opp(), stab()).ok, false);
U.S.syncSeason(data, table());
check('where the main rules still allow it', U.canPerform(opp(), stab()).ok, true);
U.S.syncSeason(data, table({ season: '1.04' }));
check('the engine resizes it at every check, from the table it is judging',
  (() => { U.check(data, table(), { kind: 'configureTable', seat: 's1', roundLimit: 5 }); return stab().size; })(), 's');
U.S.syncSeason(data, table());

// ---------- the Smoke Screens ----------
// s1: a group of 2, a group of 3, a group of 5 and a lone screen; s2 a pair.
// A Smoke Screen stands on a Large Grid, by its own column and row.
const row = (side, c0, n, r) => Array.from({ length: n }, (_, i) => ({ side, col: c0 + i, row: r }));
const smoke = () => [...row('s1', 0, 2, 0), ...row('s1', 0, 3, 2), ...row('s1', 0, 5, 4), ...row('s1', 7, 1, 7), ...row('s2', 8, 2, 0)];
const main = U.dissipationFor(smoke(), 's1');
check('main rules: only the lone screen goes whole, and 3 groups owe one each', [main.isolated.length, main.groups.map((g) => g.length)], [1, [2, 3, 5]]);
const s3 = U.dissipationFor(smoke(), 's1', 3);
check('Season 1.04: every group of 3 or fewer goes whole, and only the group of 5 owes', [s3.isolated.length, s3.groups.map((g) => g.length)], [6, [5]]);
check('the table\'s count', [U.S.smokePerGroup(data, table()), U.S.smokePerGroup(data, table({ season: '1.04' }))], [1, 3]);

const endPhase = (extra) => table({ round: { n: 2, phase: 4, firstPlayer: 's1' }, smoke: smoke(), script: U.newScriptState('s1'),
  setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } }, ...extra });
const onMain = endPhase();
U.apply(data, onMain, { kind: 'dissipateSmoke', seat: 's1' });
const onSeason = endPhase({ season: '1.04' });
U.apply(data, onSeason, { kind: 'dissipateSmoke', seat: 's1' });
check('the engine\'s dissipation: of 13 screens, the main rules take the lone one; the Season every group of 3 or fewer, both sides',
  [smoke().length, onMain.smoke.length, onSeason.smoke.length], [13, 12, 5]);
U.hudGlueAfter(data, onSeason, { kind: 'dissipateSmoke', seat: 's1' });
check('and the Match Centre owes 3 picks from the group of 5, and nothing from the rest',
  onSeason.script.smokeOwed.map((o) => `${o.side}:${o.cells.length}`), ['s1:5', 's1:5', 's1:5']);
U.hudGlueAfter(data, onMain, { kind: 'dissipateSmoke', seat: 's1' });
check('where the main rules owe one from each Connected group', onMain.script.smokeOwed.map((o) => `${o.side}:${o.cells.length}`), ['s1:2', 's1:3', 's1:5', 's2:2']);

// ---------- the pages ----------
const pad = src('../pad/pad.ts');
check('the pad\'s setup has a Rules row: the main rules, or a season in blue',
  [/\$\{rulesRow\(\)\}\n\s*<p class="pad-label pad-sec">Dice<\/p>/.test(pad),
    /chip\('', 'Main rules'\)\}\$\{\[\.\.\.\(data!\.seasons \?\? \[\]\)\]\.reverse\(\)\.map\(\(s\) => chip\(s\.id, s\.label, ' season'\)\)/.test(pad),
    /case 'set-season': send\(\{ kind: 'configureTable', seat: mySeat\(\), season: el\.dataset\.pickseason \|\| null \}\); return;/.test(pad)],
  [true, true, true]);
check('it says what the season changes, and that it is optional, and the bar names it in play',
  [/<b>\$\{esc\(on\.label\)\}, optional:<\/b>/.test(pad), /<span class="pad-bar-season" title="\$\{esc\(season\.label\)\} rules: optional, not the main rules">/.test(pad)],
  [true, true]);
check('every page resizes the Actions before it draws',
  [/function render\(\): void \{\n[\s\S]{0,500}if \(data\) syncSeason\(data, table\);/.test(pad),
    /function render\(\): void \{\n[\s\S]{0,500}if \(data\) syncSeason\(data, state\);/.test(src('../src/match.ts')),
    /function renderAll\(\): void \{\n[\s\S]{0,120}syncSeason\(data, state\);/.test(src('../src/main.ts'))],
  [true, true, true]);
check('both boards pick the owed screens among those still standing',
  [/function smokeOwedCells\(state: GameState\)/.test(src('../src/matchhud.ts')), /const standing = next\.group\.filter/.test(src('../src/main.ts'))],
  [true, true]);

// The pad has no screens to count, so its End Phase says how many go: the
// Season's count while one is on (OTTO, 2026-09-30: "did we test this new
// engine logic on the pad as well?").
const guided = src('../pad/guided.ts');
check('the pad\'s End Phase names the Season\'s Smoke count while one is on',
  [/const per = smokePerGroup\(api\.data, s\);/.test(guided), /a Connected group of \$\{per\} or fewer comes off whole, and each larger group loses \$\{per\}/.test(guided)],
  [true, true]);

// THE MATCH CENTRE SAYS SO (2026-10-05: a game against the computer may be set
// on the Season from the Play the computer dialog, and the round chip is the one
// place a player sees which rules a game plays): matchhud.ts timelineHtml, run.
{
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const cut = (a, b) => { const i = hud.indexOf(a); const j = hud.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`no ${a}`); return hud.slice(i, j); };
  const slice = new URL('./_seasonplay.timeline.slice.ts', import.meta.url);
  writeFileSync(slice, `const PHASES = ['Command', 'Planning', 'Action', 'Automatic', 'Delay', 'End'];
${cut('function esc(s: string): string {', '\n}\n')}
}
export ${cut('function timelineHtml(s: GameState): string {', '\n}\n').replace('s: GameState', 's: any')}
}
`);
  const { timelineHtml } = await import(`${slice.href}?v=${Date.now()}`);
  const on = timelineHtml({ round: { n: 2, phase: 1 }, roundLimit: 5, season: '1.04' });
  const off = timelineHtml({ round: { n: 2, phase: 1 }, roundLimit: 5 });
  check('the Match Centre\'s round chip names the Season a table plays, in its blue, saying it is optional',
    [/<div class="roundchip">R2\/5<span class="roundchip-season" title="Season 1\.04 rules: optional, not the main rules">Season 1\.04<\/span><\/div>/.test(on), /roundchip-season/.test(off)], [true, false]);
  check('in the blue the pad marks it in', /\.roundchip-season \{[^}]*color: var\(--blue\)/.test(readFileSync(new URL('../src/match.css', import.meta.url), 'utf8')), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
