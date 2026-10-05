// The tabletop's squad panels, as OTTO asked for them on 2026-10-05: a ✕ beside
// a Tactics Card in the Squads tab takes it out of the squad without a trip to
// the Add tab; the Add tab's buttons say a card is held by their colour alone;
// and every saved build and squad, the built-in starters included, has a ✕, a
// built-in one put away as the pad puts it away, with a link to bring the
// starters back.
//
// The Squads tab is drawn for real into the test DOM (src/squads.ts). The Add
// tab's builder needs a whole page, so what it draws is pinned in its source.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The squad panels\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_squadpanel.entry.ts', import.meta.url);
const out = new URL('./_squadpanel.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { SquadTracker } from '../src/squads';",
  "export { setLocalSeat } from '../src/loop';",
  "export { newScriptState } from '../src/types';",
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

// ---------- the Squads tab: a ✕ beside each card ----------
{
  const dropped = [];
  const cb = new Proxy({ onDropTactic: (side, id) => dropped.push(`${side}:${id}`) }, { get: (o, k) => o[k] ?? (() => {}) });
  const tr = new U.SquadTracker(data, makeEl('div'), cb);
  const table = (setup) => ({
    v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' },
    tactics: { s1: ['274', '275'], s2: ['276'] }, tacticsPlayed: { s1: [], s2: [] },
    script: { ...U.newScriptState('s1') }, ...(setup ? { setup } : {}),
  });
  const xs = (side) => tr.tacticsBlock(side)?.querySelectorAll('.ui-x') ?? [];
  const row = (side) => tr.tacticsBlock(side)?.querySelectorAll('.sq-tac-row')[0];
  tr.state = table(null);
  const first = xs('s1');
  first[1]?.click();
  check('BEFORE A GAME each card in a squad\'s hand has a ✕, after its Play, which takes that card out of that squad',
    [first.length, row('s1').children.map((c) => c.className), /^Take .+ out of Squad 1$/.test(first[0]?.title ?? ''), dropped],
    [2, ['sq-tac-name', 'sq-tac-when', 'sq-tac-play', 'ui-x'], true, ['s1:275']]);
  U.setLocalSeat('s1');
  try {
    check('in a room, only this seat\'s own cards', [xs('s1').length, xs('s2').length], [2, 0]);
  } finally {
    U.setLocalSeat(null);
  }
  tr.state = table({ stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } });
  check('and none once a game is under way: the hand is the one dealt', [xs('s1').length, xs('s2').length], [0, 0]);
  const quiet = new U.SquadTracker(data, makeEl('div'), new Proxy({}, { get: (o, k) => (k === 'onDropTactic' ? undefined : () => {}) }));
  quiet.state = table(null);
  check('a page that cannot take a card out offers no ✕', quiet.tacticsBlock('s1').querySelectorAll('.ui-x').length, 0);
}

// ---------- the Add tab ----------
{
  const roster = src('../src/roster.ts');
  const styles = src('../src/styles.css');
  const main = src('../src/main.ts');
  check('A HELD CARD\'S BUTTON is its squad number alone, coloured solid: no mark beside the number to move the row',
    [/const b = this\.squadButton\(side, null\);\n\s*if \(n\) b\.classList\.add\('has'\);/.test(roster), /✓/.test(roster),
      /button\.add\.sq-add\.has, button\.add\.sq-add\.has:hover \{ background: var\(--sq-tint, var\(--accent\)\); color: var\(--on-accent\); \}/.test(styles)],
    [true, false, true]);
  check('the Add tab and the Squads tab take a card out the one way',
    [/onDropTactic: \(card, side\) => dropTactic\(side, card\.id\),/.test(main), /onDropTactic\(side, id\) \{\n\s*dropTactic\(side, id\);/.test(main)], [true, true]);
  check('EVERY SAVED ROW has a ✕, the built-in starters\' included',
    [/<button class="ui-x" data-remove="\$\{escAttr\(r\.id\)\}" title="Remove \$\{escAttr\(r\.name\)\}"/.test(roster), /removable/.test(roster)], [true, false]);
  check('a built-in starter is put away in the pad\'s words, and a saved one removed',
    [roster.includes('The built-in starter is put away, here and on your account. A link under the lists brings the starters back.'),
      /if \(!\(await this\.confirmRemove\(found\.name, isBuiltInPreset\(found\.id\), 'build'\)\)\) return;\n\s*deleteMechPreset\(found\.id\);/.test(roster),
      /if \(!\(await this\.confirmRemove\(found\.name, isBuiltInSquad\(found\.id\), 'squad'\)\)\) return;\n\s*deleteSquad\(found\.id\);/.test(roster)],
    [true, true, true]);
  check('and under the lists, while any is put away, the link that brings them back',
    /const hidden = hiddenBuiltIns\(\)\.length;\n\s*if \(hidden\) \{[\s\S]{0,200}back\.textContent = `Show the built-in starters again \(\$\{hidden\}\)`;\n\s*back\.addEventListener\('click', \(\) => \{ restoreBuiltIns\(\); this\.render\(\); \}\);/.test(roster), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
