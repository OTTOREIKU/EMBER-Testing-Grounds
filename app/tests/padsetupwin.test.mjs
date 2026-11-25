// THE GAME SETUP WINDOW (player feedback 2026-11-25; OTTO picked mockup B the
// same day): a Guided game's setup in one window shaped like the attack
// window, from the squads to Begin Round 1. The Main Task draw used to send
// the player to the Tasks tab, away from the table edge that came next.
// Pinned by behaviour on bare states (pad/setupwin.ts), plus the wiring in
// pad.ts. The look and a full playthrough are in the manual checklist.
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

console.log('PAD Game setup window\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_padsetupwin.entry.ts', import.meta.url);
const out = new URL('./_padsetupwin.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export * as W from '../pad/setupwin';",
  "export { newSetup } from '../src/setup';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const mod = await import(`${out.href}?t=${Date.now()}`);
const data = await mod.loadData();
const { W } = mod;

// ---------- which step is open ----------
{
  const su = (stage) => ({ ...mod.newSetup(), stage });
  check('not started: the squads', W.setupStepStates(true, null, undefined), ['now', 'todo', 'todo', 'todo', 'todo', 'todo']);
  check('the roll', W.setupStepStates(false, su('roll'), undefined), ['done', 'now', 'todo', 'todo', 'todo', 'todo']);
  check('the tabletop\'s map stage reads as the roll', W.setupStepStates(false, su('map'), undefined)[1], 'now');
  check('side stage, no Main Task: the Main Task', W.setupStepStates(false, su('side'), undefined), ['done', 'done', 'now', 'todo', 'todo', 'todo']);
  check('side stage with one: the edge', W.setupStepStates(false, su('side'), 'm1'), ['done', 'done', 'done', 'now', 'todo', 'todo']);
  check('choosing the Main Task again opens it', W.setupStepStates(false, su('side'), 'm1', true)[2], 'now');
  check('tasks stage: the Secondaries', W.setupStepStates(false, su('tasks'), 'm1'), ['done', 'done', 'done', 'done', 'now', 'todo']);
  check('deploy', W.setupStepStates(false, su('deploy'), 'm1')[5], 'now');
  check('done: every step done', W.setupStepStates(false, su('done'), 'm1'), ['done', 'done', 'done', 'done', 'done', 'done']);
}

// ---------- the window on a bare state ----------
const a = mech(1, 's1', 'Alpha', 1); a.deployed = false;
const b = mech(2, 's2', 'Bravo', 2); b.deployed = false;
const state = (stage, extra = {}) => ({
  tokens: [a, b], round: { n: 1, phase: 0, firstPlayer: 's2' }, setup: { ...mod.newSetup(), stage, rolls: { s1: [0], s2: [1] }, first: 's2' },
  tasks: {}, mission: null, ...extra,
});
const api = (st, me = 's1', solo = true) => ({
  data, state: () => st, me: () => me, solo, inRoom: () => !solo, esc: (x) => String(x).replace(/</g, '&lt;'),
  sideName: (s) => (s === 's1' ? 'Player 1' : 'Player 2'), actorName: (s) => (s === 's1' ? 'Player 1' : 'Player 2'),
  readiness: () => ({ me: false, them: false }), check: () => ({ ok: true }),
});
const extras = (o = {}) => ({
  pending: false, headline: 'Guided · 900 pts · 5 rounds · S1.04',
  squadLine: (s) => (s === 's1' ? 'Player 1 · RDL · 376 pts' : 'Player 2 · UN · 346 pts'),
  squadsBody: '<p>SQUADS</p>', mainBody: '<p>MAINBODY</p>', mainPicking: false,
  secondaryCards: (s) => `<p>CARDS-${s}</p>`, secondaryOpen: () => false, ...o,
});
const head = (html, step) => {
  const m = new RegExp(`data-step="${step}">\\s*<div class="ah-card-h"><span class="n">([^<]*)</span><span class="t">[^<]*</span><span class="r">([^<]*)</span>`).exec(html);
  return m ? [m[1], m[2]] : null;
};
{
  const mission = data.missions.cards[0];
  const html = W.setupWindowHtml(api(state('side')), extras());
  check('the header names the game', html.includes('<b>Game setup</b><span class="dim">Guided · 900 pts · 5 rounds · S1.04</span>'), true);
  check('a finished step is ticked with what was decided', head(html, 'squads'), ['✓', '376 v 346 pts']);
  check('the First Player is said', head(html, 'roll'), ['✓', 'Player 2 goes first']);
  check('the Main Task is open with the pad\'s body', html.includes('<p>MAINBODY</p>'), true);
  check('the edge to come says who picks', head(html, 'edge'), ['4', 'Player 2 picks']);
  check('only one step is open', (html.match(/class="ah-card now"/g) ?? []).length, 1);
  const edge = W.setupWindowHtml(api(state('side', { mission: mission.id })), extras());
  check('with a Main Task it is folded to its name', head(edge, 'main'), ['✓', mission.name]);
  check('the edge step offers both edges', ['data-edge="white"', 'data-edge="black"'].every((x) => edge.includes(x)), true);
  check('and a way back to the Main Task', edge.includes('data-act="ws-main-change"'), true);
  const other = W.setupWindowHtml(api(state('side', { mission: mission.id }), 's1', false), extras());
  check('in a room the other player sees who is picking', other.includes('Player 2 · picking an edge') && !other.includes('data-act="g-edge"'), true);
  const preroll = W.setupWindowHtml(api(state('roll')), extras());
  check('before the roll nobody is named for the edge', head(preroll, 'edge'), ['4', '']);
}
{
  const sec = data.secondary[0];
  const st = state('tasks', { mission: data.missions.cards[0].id });
  const html = W.setupWindowHtml(api(st), extras());
  check('the First Player\'s Secondary cards are inline', html.includes('<p>CARDS-s2</p>'), true);
  check('the other squad waits for them', html.includes('<p>CARDS-s1</p>'), false);
  check('the header says who chooses', head(html, 'tasks'), ['5', 'Player 2 chooses']);
  check('Continue waits for both', /data-act="g-tasks-done" disabled/.test(html), true);
  st.tasks = { secondary: { s2: sec.id } };
  const next = W.setupWindowHtml(api(st), extras());
  check('then the other squad\'s cards', next.includes('<p>CARDS-s1</p>') && !next.includes('<p>CARDS-s2</p>'), true);
  check('a picked one can be changed', next.includes('data-act="ws-sec-change" data-side="s2"'), true);
  const reopened = W.setupWindowHtml(api(st), extras({ secondaryOpen: (s) => s === 's2' }));
  check('Change opens its cards again', reopened.includes('<p>CARDS-s2</p>'), true);
}
{
  const st = state('deploy', { mission: data.missions.cards[0].id, tasks: { secondary: { s1: data.secondary[1].id, s2: data.secondary[0].id } } });
  const html = W.setupWindowHtml(api(st), extras());
  check('deploy lists the units to place', html.includes('data-act="g-deploy"'), true);
  check('and says whose turn', head(html, 'deploy')[1].endsWith('places'), true);
  check('the Secondaries are folded to their names', head(html, 'tasks'), ['✓', `${data.secondary[0].name} · ${data.secondary[1].name}`]);
}
{
  const html = W.setupWindowHtml(api(state('roll')), extras({ pending: true }));
  check('not started: the squads step shows the pad\'s squad body', html.includes('<p>SQUADS</p>'), true);
}

// ---------- the wiring ----------
{
  const pad = src('pad/pad.ts');
  check('the window is a panel', pad.includes("if (panel === 'gsetup') return setupWinPanel();"), true);
  check('it shows while setup runs and nothing else is open', pad.includes("if (setupRunning() && panel === null && setupClosedFor !== gameId()) panel = 'gsetup';"), true);
  check('and goes when setup ends', pad.includes("if (panel === 'gsetup' && !setupRunning()) panel = null;"), true);
  const running = body(pad, 'function setupRunning');
  check('setup runs from choosing Guided until the stage is done', running.includes("return !!su && su.stage !== 'done';") && running.includes('if (wantsGuided() && !guidedOn(table)) return true;'), true);
  check('a player tab puts it away for this game', pad.includes("if ((which === 'yours' || which === 'theirs') && setupRunning()) setupClosedFor = gameId();"), true);
  check('the strip brings it back', pad.includes('data-act="setup-open">Setup steps</button>'), true);
  const gmain = pad.slice(pad.indexOf("    case 'g-main':"), pad.indexOf("    case 'g-secondary':"));
  check('Draw 3 on the strip draws in the window, not on the Tasks tab', gmain.indexOf("panel = 'gsetup';") >= 0 && gmain.indexOf("panel = 'gsetup';") < gmain.indexOf("panel = 'tasks';"), true);
  check('a Secondary card names its side', pad.includes("if (el.dataset.for === 's1' || el.dataset.for === 's2') pickFor = el.dataset.for;"), true);
  check('the Tasks tab and the window share the draw list', (pad.match(/\$\{drawCardsHtml\(\)\}/g) ?? []).length, 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
