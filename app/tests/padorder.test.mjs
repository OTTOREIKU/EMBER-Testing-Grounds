// THE PAD'S TURN ORDER (OTTO, 2026-10-17 and 22): the bar's ORDER sheet and the
// Guided strip's track (pad/order.ts). The Mechs must come in the engine's own
// order (loop.ts activationOrder, 3.4.1) and say who has gone, who acts and who
// is next; a dial this phone cannot read stays out of the numbering; the track
// shows in the Action Phase only. Pinned by behaviour on a bare state, plus the
// two wiring lines in the pad.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_padorder.entry.ts', import.meta.url);
const out = new URL('./_padorder.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export * as O from '../pad/order';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { O } = M;
const data = await M.loadData();
const look = { esc: (s) => s, sideName: (s) => (s === 's1' ? 'Player 1' : 'Player 2') };

// No pilots, so no Initiative: within a Timing the squads alternate from the
// First Player, which is the tie rule (3.4.1).
const mech = (uid, side, label, timing) => ({ uid, kind: 'mech', side, label, timing, partStates: {} });
const table = (phase, acted = [], opp = null) => ({
  round: { n: 2, phase, firstPlayer: 's1' },
  tokens: [
    mech(1, 's2', 'Caracal', 'swift'), mech(2, 's1', 'Dune A', 'melee'), mech(3, 's2', 'Warden', 'melee'),
    mech(4, 's1', 'Dune B', 'projectile'), mech(5, 's2', 'Raptor', 'firing'),
    { uid: 9, kind: 'drone', side: 's1', label: 'Hornet', partStates: {} },
  ],
  script: { acted, opp, tieFirst: [], mode: 'hotseat', revealed: [], stage: '' },
});

console.log('Pad turn order\n');
{
  const v = O.turnOrder(data, table(2, [1, 2], { uid: 3, timing: 'melee' }), true);
  check('Mechs in Timing order, tied Melee alternating from the First Player',
    v.rows.map((r) => r.label), ['Caracal', 'Dune A', 'Warden', 'Dune B', 'Raptor']);
  check('gone, acting, next and still to come', v.rows.map((r) => r.state), ['done', 'done', 'now', 'next', 'up']);
  check('the tied pair is marked, the others not', v.rows.map((r) => r.tie), [false, true, true, false, false]);
  check('Drones are listed apart, with no place in the order', v.drones.map((t) => t.label), ['Hornet']);
}
{
  const v = O.turnOrder(data, table(2, [1, 2], { uid: 3, timing: 'melee' }), false);
  check('a Freeform table keeps no record, so no row says who has gone', [...new Set(v.rows.map((r) => r.state))], ['free']);
  check('before the Action Phase every Mech is still to come',
    [...new Set(O.turnOrder(data, table(0), true).rows.map((r) => r.state))], ['up']);
  check('after it every Mech has gone',
    [...new Set(O.turnOrder(data, table(3), true).rows.map((r) => r.state))], ['done']);
}
{
  const s = table(2, [1]);
  s.tokens[4].timing = undefined;
  const v = O.turnOrder(data, s, true);
  check('a Mech with no dial this phone can read is held out of the numbering',
    [v.rows.map((r) => r.label), v.hidden.map((t) => t.label)], [['Caracal', 'Dune A', 'Warden', 'Dune B'], ['Raptor']]);
  check('and the sheet lists it under a ?', /\?<\/span>[\s\S]*Raptor[\s\S]*NO DIAL/.test(O.orderSheetHtml(data, s, true, look)), true);
}
{
  const s = table(2, [1, 2], { uid: 3, timing: 'melee' });
  const track = O.orderTrackHtml(data, s, look);
  check('the track has one segment per Mech, faded, thick and to come',
    [...track.matchAll(/<i class="(\w+)"/g)].map((m) => m[1]), ['done', 'done', 'now', 'next', 'up']);
  check('and says where the turn is and who is next', /3 \/ 5<\/span><span>NEXT <b>Dune B<\/b>/.test(track), true);
  check('the track opens the sheet', /data-act="order"/.test(track), true);
  check('outside the Action Phase there is no track', O.orderTrackHtml(data, table(1), look), '');
  const sheet = O.orderSheetHtml(data, s, true, look);
  check('the sheet names the round, the phase and the First Player',
    [/Turn order · R2 \/\/ Action/.test(sheet), /Player 1 is First Player this round\./.test(sheet)], [true, true]);
  check('every row opens its unit', (sheet.match(/data-act="order-unit"/g) ?? []).length, 6);
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pad = src('../pad/pad.ts');
const guided = src('../pad/guided.ts');
check('the bar says Solo or Multi, and carries the ORDER chip before the round chip',
  [/>Solo<\/span>'/.test(pad), /">Multi<\/span>`/.test(pad), /\$\{who\}<\/div>\s*\$\{orderChip\}\s*<button class="pad-bar-round/.test(pad)], [true, true, true]);
check('the Guided Action step draws the track under its head',
  /return head\(api, t\.label, tm \|\| 'Action Phase', owner\)\s*\+ orderTrackHtml\(/.test(guided), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
