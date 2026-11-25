// PAD LAYOUT FEEDBACK, BATCH 1 (player feedback relayed by OTTO, 2026-11-25):
//  - Season 1.04 pushed the bar's Continue chip and the score off a phone.
//  - A squad picked by mistake could not be swapped before the game.
//  - Saved units and squads could be added mid-game.
//  - A Drone's stats had no Armor; its Action rows said "Unit".
//  - An Action row showed its length (the capsule shows it) and not its Range.
//  - The "which Mech commands this Drone" question did not say how many
//    Command Tokens each Mech had left.
// Pinned by behaviour where the code is a plain reader (pad/padbits.ts,
// guided.ts commanderChoices) and by the wiring lines in pad.ts and pad.css.
// The look on a phone is in the manual checklist.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (text, head) => {
  const i = text.indexOf(head);
  return i < 0 ? '' : text.slice(i, text.indexOf('\n}\n', i));
};

console.log('PAD layout feedback, batch 1\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_padlayout.entry.ts', import.meta.url);
const out = new URL('./_padlayout.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export * as B from '../pad/padbits';",
  "export { commanderChoices } from '../pad/guided';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const mod = await import(`${out.href}?t=${Date.now()}`);
const pad = src('pad/pad.ts');
const css = src('pad/pad.css');

// ---------- the bar ----------
{
  check('Season 1.04 reads S1.04 on the bar', mod.B.seasonShort('Season 1.04'), 'S1.04');
  check('a label without "Season" is left alone', mod.B.seasonShort('1.05 beta'), '1.05 beta');
  const bar = body(pad, 'function barHtml');
  check('the Season tag sits on the line under the phase', bar.includes('<span class="pad-bar-sub">${seasonTag}${hint}</span>'), true);
  check('and no longer beside it', bar.includes(' · ${esc(season.label)}'), false);
  check('the round chip may shrink, the score may not', /\.pad-bar-round \{ flex: 0 1 auto; min-width: 0; \}/.test(css), true);
  check('a phone shows the ORDER icon alone', css.includes('@media (max-width: 440px) { .pad-bar-order span { display: none; }'), true);
}

// ---------- swapping and locking squads ----------
{
  const pick = pad.slice(pad.indexOf("    case 'squad': {"), pad.indexOf("    case 'preset-del':"));
  check('a saved squad asks Replace or Add when the side has units', pick.includes('replaceOrAdd(seat, sq.name)'), true);
  check('Replace clears the side first', pick.includes("how === 'replace' && !clearSide(seat)"), true);
  check('and the new squad joins the removal for one Undo', pick.includes("sendSquad(sq.name, sq.mechs, sq.drones, how === 'replace')"), true);
  check('sendSquad marks a joined import', body(pad, 'function sendSquad').includes("...(chain ? { chain: 'join' as const } : {})"), true);
  const clear = body(pad, 'function clearSide');
  check('clearSide removes carried tokens before their carrier', clear.includes('Number(b.parentUid !== undefined) - Number(a.parentUid !== undefined)'), true);
  check('every despawn after the first joins it', clear.includes("...(chain ? { chain: 'join' as const } : {})"), true);
  check('and the hand is emptied', clear.includes('handCommand(seat, [], roomKey())'), true);
  check('a squad file asks the same question', body(pad, 'async function importFromFile').includes('replaceOrAdd(solo ? squadSide : mySeat(), squad.name)'), true);
  const ask = body(pad, 'async function replaceOrAdd');
  check('an empty side is not asked', ask.includes("if (!sideUnits(seat).length) return 'add';"), true);
  const more = body(pad, 'function morePanel');
  check('Remove this squad is offered while squads may change', more.includes('data-act="clear-side">Remove this squad'), true);
  check('the add buttons hide once squads are locked', more.includes('${squadsLocked()\n'), true);
  const locked = body(pad, 'function squadsLocked');
  check('a Guided game locks when deployment ends', locked.includes('if (squadsClosed())'), true);
  check('a Freeform table locks once the first phase turns', locked.includes('table.round.n > 1 || table.round.phase > 0'), true);
  check('Freeform can be unlocked for this game', pad.includes("case 'squads-unlock': squadsUnlocked = gameId();"), true);
  const saved = body(pad, 'function savedHtml');
  check('the saved lists hide when squads are locked, Save stays', saved.includes("if (squadsLocked()) {\n    return anyUnits ? '<p class=\"pad-label pad-sec\">Saved squads</p><button class=\"pad-btn\" data-act=\"save-squad\">"), true);
}

// ---------- the sheet ----------
{
  const stats = body(pad, 'function statStrip');
  check('a Drone shows its Armor', stats.includes("t.kind === 'mech' ? null : live.reduce((n, c) => n + (c.card.armor ?? 0), 0)"), true);
  check('a Mech does not (it is on each Part)', stats.includes("${armor === null ? '' : chip('armor', armor, 'Armor')}"), true);
  check('seven stats lay out four over three', css.includes('.pad-stats-7 .ds:nth-child(-n+4) { grid-column: span 3; }'), true);
  const list = body(pad, 'function actionList');
  check('a one-Part unit\'s rows do not say "Unit"', list.includes("g.slot === 'main' ? '' : SLOT_LABEL[g.slot] ?? g.slot"), true);
  check('the row shows the Range', list.includes('rangeMeta(g.action.range, actionRange(d, table.tokens, t, g.action))'), true);
  check('and no longer the length', list.includes('len ? LENGTH_NAME[len]'), false);
  check('the Common Actions show the Range too', body(pad, 'function commonRows').includes('rangeMeta(a.range, actionRange(d, table.tokens, t, a))'), true);
  check('Range 3 prints as Range 3', mod.B.rangeMeta(3, 3), 'Range 3');
  check('an aura that adds 1 is counted', mod.B.rangeMeta(6, 7), 'Range 7');
  check('Range 0 prints as the card does', mod.B.rangeMeta(0, 0), 'Range --');
  check('no printed Range, nothing said', mod.B.rangeMeta(undefined, 0), '');
}

// ---------- who commands the Drone ----------
{
  const a = mech(1, 's1', 'Alpha', 1); a.statuses = ['command', 'command'];
  const b = mech(2, 's1', 'Bravo', 2); b.statuses = ['command'];
  const c = mech(3, 's1', 'Charlie', 3); c.statuses = [];
  const foe = mech(4, 's2', 'Foe', 4); foe.statuses = ['command'];
  const rows = mod.commanderChoices([a, b, c, foe], 's1');
  check('each Mech of the side, with its Command Tokens left', rows.map((r) => r.label), [
    'Alpha · 2 Command Tokens left', 'Bravo · 1 Command Token left', 'Charlie · 0 Command Tokens left', 'Cancel']);
  check('a Mech with none is greyed', rows.map((r) => !!r.disabled), [false, false, true, false]);
  check('the other side is not listed', rows.some((r) => r.label.startsWith('Foe')), false);
  check('the question uses it', src('pad/guided.ts').includes('choices: commanderChoices(s.tokens, side), stacked: true'), true);
}

// ---------- batch 2: Drone and Mech action layout ----------
{
  const g = mod.B.actionGroupOf;
  const tm = { index: 2, name: 'Swift' };
  check('a Command Action has its own heading', g({ speed: 'command' }, tm), { name: 'Command Actions', rank: 95 });
  check('an Automatic Action is apart from them', g({ speed: 'auto' }, tm), { name: 'Automatic Actions', rank: 96 });
  check('Automatic comes after Command', g({ speed: 'auto' }).rank > g({ speed: 'command' }).rank, true);
  check('a dial Action goes by its Timing', g({ speed: 'fast' }, tm), { name: 'Swift', rank: 2 });
  check('a Passive goes last', g({ type: 'Passive', speed: 'passive' }, tm), { name: 'Passive', rank: 98 });
  check('no Timing: by its type', g({ type: 'Delay' }), { name: 'Delay', rank: 97 });
  check('no "Automatic and Command" heading left', pad.includes("'Automatic and Command'"), false);
  const row = body(pad, 'function moveRow');
  check('a Mech gets a Maneuver row above everything', row.includes("{ group: 'Maneuver', rank: -1, html }"), true);
  check('a Drone gets a Move row first in its Command Actions', row.includes("{ group: 'Command Actions', rank: 95, html }"), true);
  check('Guided: the row records the move', row.includes('data-act="g-moved"'), true);
  check('Freeform: the row spends the Maneuver Tick', row.includes('data-act="tick-moved">Maneuvered</button>'), true);
  check('a spent tick greys the button', row.includes("canManeuver(o).ok ? chip : inert(chip"), true);
  const list = body(pad, 'function actionList');
  check('the Maneuver goes in before the first group', list.includes('if (move && move.rank < 0) addMove();'), true);
  check('the Move goes in before the first Command Action', list.includes('if (move && !moved && gr >= move.rank) addMove();'), true);
  check('the ticks row lost its Moved chip', /data-act="tick-moved"[^\n]*>Moved</.test(pad), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
