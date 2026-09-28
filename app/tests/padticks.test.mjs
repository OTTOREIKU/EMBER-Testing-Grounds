// THE PAD'S TICKS (2026-09-27): the rulebook's Action Opportunity capsule
// (3.4.5, p.31) on the pad. A thick X for the Maneuver Tick, then a square for
// each Action Tick, spent in that order.
//
// Four pieces, each pinned by behaviour:
//   - the state a page draws the bar from (ticks.ts tickBarState);
//   - the bar itself (glyphs.ts tickBar);
//   - the marks a free table makes by hand (markManeuver, markAction, markExtra);
//   - the engine's record of them (setFreeTicks, Token.freeTicks), cleared on
//     every path that starts the Opportunities over.
import { writeFileSync } from 'node:fs';
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
const entry = new URL('./_padticks.entry.ts', import.meta.url);
const out = new URL('./_padticks.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { newScriptState } from '../src/types';",
  "export * as T from '../src/ticks';",
  "export * as G from '../src/glyphs';",
  "export * as Y from '../src/types';",
  "export * as U from '../src/units';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { T, G, Y, U } = M;
const data = await M.loadData();

const L = () => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2' });
const actionsOf = (size, type) => data.cards.flatMap((c) => c.actions ?? []).filter((a) => a.size === size && T.timingOf(a) && (!type || a.type === type));
const short = actionsOf('s', 'Firing')[0];
const medium = actionsOf('m', 'Firing')[0];
const long = data.byId.get('ZHRA-101')?.actions?.find((a) => a.id === 'ZHRA-101_B');

console.log('Pad Ticks\n');
check('fixtures: a Short, a Medium and a Long Action', [T.lengthOf(short), T.lengthOf(medium), T.lengthOf(long)], ['short', 'medium', 'long']);

// ================= the state the bar is drawn from =================
{
  const fresh = Y.newOpportunity(1);
  check('a fresh Opportunity is the X and two squares, nothing spent',
    T.tickBarState(fresh), { maneuver: 'free', actions: [false, false], extras: [] });
  check('a Maneuver spends the X', T.tickBarState(T.spendManeuver(fresh)).maneuver, 'spent');
  const shot = T.spendAction(fresh, short);
  // In order: an Action Tick spent first means the X can no longer be used.
  check('a Short Action with no Maneuver spends one square, and the X is gone',
    [T.tickBarState(shot).maneuver, T.tickBarState(shot).actions], ['lost', [true, false]]);
  const big = T.spendAction(fresh, long);
  check('a Long Action spends the X and both squares',
    [T.tickBarState(big).maneuver, T.tickBarState(big).actions], ['spent', [true, true]]);
  const med = T.spendAction(T.spendManeuver(fresh), medium);
  check('Maneuver then Medium: everything spent, none of it lost',
    [T.tickBarState(med).maneuver, T.tickBarState(med).actions], ['spent', [true, true]]);
  const extra = { id: 'X1', label: 'Sustained Fire', timing: 'firing' };
  const withX = { ...fresh, timing: 'firing', extras: [extra] };
  check('an Extra Tick is drawn after the base Ticks, with the Type it pays for',
    T.tickBarState(withX).extras, [{ id: 'X1', label: 'Sustained Fire', timing: 'firing', spent: false, lapsed: false }]);
  const lapsing = { ...fresh, timing: 'melee', extras: [{ ...extra, check: 'timing' }] };
  check('and one whose condition fails reads as lapsed, not spent',
    [T.tickBarState(lapsing).extras[0].spent, T.tickBarState(lapsing).extras[0].lapsed], [false, true]);
}

// ================= the marks a free table makes by hand =================
{
  const fresh = Y.newOpportunity(1);
  const moved = T.markManeuver(fresh);
  check('tapping a free X spends it, as a Maneuver', [moved.maneuvered, T.tickBarState(moved).maneuver], [true, 'spent']);
  const back = T.markManeuver(moved);
  check('tapping it again takes it back', [back.maneuvered, back.maneuver, T.tickBarState(back).maneuver], [false, 1, 'free']);
  const lost = T.markManeuver(T.spendAction(fresh, short));
  check('a gone X cannot be marked, and says why', typeof lost.why === 'string' && /in order/.test(lost.why), true);
  const afterLong = T.markManeuver(T.spendAction(fresh, long));
  check('a Long Action\'s X can be taken back, and then reads as gone',
    [afterLong.maneuver, T.tickBarState(afterLong).maneuver], [1, 'lost']);

  const one = T.markAction(fresh, 0);
  check('tapping the first square spends it, and the X is gone', [one.action, T.tickBarState(one).maneuver], [1, 'lost']);
  const two = T.markAction(fresh, 1);
  check('tapping the second spends both, in order', T.tickBarState(two).actions, [true, true]);
  const undone = T.markAction(two, 1);
  check('tapping a spent square takes back it and every one after it', T.tickBarState(undone).actions, [true, false]);
  const clean = T.markAction({ ...two, performed: ['x'] }, 0);
  check('taking back the last one leaves nothing performed, and the X free again',
    [clean.started, clean.performed, T.tickBarState(clean).maneuver], [false, [], 'free']);

  const withX = { ...fresh, extras: [{ id: 'X1', label: 'Sustained Fire', timing: 'firing' }] };
  check('an Extra Tick toggles', [T.markExtra(withX, 'X1').spentExtras, T.markExtra(T.markExtra(withX, 'X1'), 'X1').spentExtras], [['X1'], []]);
  check('and an unknown one changes nothing', T.markExtra(withX, 'nope'), withX);
}

// ================= the bar =================
{
  const s = T.tickBarState(Y.newOpportunity(1));
  const tap = G.tickBar(s, { act: 'tick' });
  const ticksOf = (h) => [...h.matchAll(/data-tick="([^"]+)"/g)].map((m) => m[1]);
  check('a tappable bar is three buttons: the X and two squares', [(tap.match(/<button/g) ?? []).length, ticksOf(tap)], [3, ['m', 'a0', 'a1']]);
  check('each sends the act it was given', (tap.match(/data-act="tick"/g) ?? []).length, 3);
  check('the X is drawn, not typed: the heavy X comes first', tap.indexOf(G.MANEUVER_X) > 0 && tap.indexOf(G.MANEUVER_X) < tap.indexOf('data-tick="a0"'), true);
  const pic = G.tickBar(s);
  check('without an act it is a picture, with nothing to tap', [/<button/.test(pic), (pic.match(/role="img"/g) ?? []).length], [false, 3]);
  const guided = G.tickBar(s, { maneuverAct: 'g-moved' });
  check('a guided sheet taps the X alone, as Moved (M)', [(guided.match(/<button/g) ?? []).length, /data-act="g-moved" data-tick="m"/.test(guided)], [1, true]);
  const worn = G.tickBar(T.tickBarState(T.spendAction(Y.newOpportunity(1), short)), { act: 'tick' });
  check('spent and gone Ticks carry their state', [/tk-m lost/.test(worn), /tk-a spent" data-act="tick" data-tick="a0"/.test(worn), /aria-pressed="true"/.test(worn)], [true, true, true]);
  const xs = G.tickBar({ maneuver: 'free', actions: [false, false], extras: [{ id: 'X1', label: 'Sustained Fire', timing: 'firing', spent: false, lapsed: false }] }, { act: 'tick' });
  check('an Extra Tick follows a divider, labelled by its Type', [/tk-div/.test(xs), /<b>FIR<\/b>/.test(xs), /data-tick="x:X1"/.test(xs)], [true, true, true]);
  check('a label is escaped', /&quot;/.test(G.tickBar({ maneuver: 'free', actions: [], extras: [{ id: 'a"b', label: 'x', spent: false, lapsed: false }] }, { act: 'tick' })), true);
  // A gone X cannot be marked or taken back, so even a tappable bar draws it as
  // a picture: nothing to tap, nothing to refuse.
  const gone = G.tickBar(T.tickBarState(T.spendAction(Y.newOpportunity(1), short)), { act: 'tick' });
  check('a gone X is never a button', [/<button[^>]*data-tick="m"/.test(gone), /<span class="tk tk-m lost"/.test(gone), (gone.match(/<button/g) ?? []).length], [false, true, 2]);
}

// ================= the capsule shows the Ticks a unit is short of =================
// The pad greys the ones a Mech no longer has, top down: a Long Action's top
// slot is its Maneuver Tick, and the rest are Action Ticks.
{
  const slots = (h) => [...h.matchAll(/<i( class="on( short)?")?><\/i>/g)].map((m) => (m[2] ? 's' : m[1] ? '#' : '.')).join('');
  check('nothing short draws the capsule as printed', slots(G.tickCapsule(2)), '.##');
  check('a Medium Action one Tick short: the upper square goes faint', slots(G.tickCapsule(2, '', { actions: 1 })), '.s#');
  check('a Short Action with none left', slots(G.tickCapsule(1, '', { actions: 1 })), '..s');
  check('a Long Action with the X gone: its top slot', slots(G.tickCapsule(3, '', { maneuver: true })), 's##');
  check('a Long Action short of everything', slots(G.tickCapsule(3, '', { maneuver: true, actions: 2 })), 'sss');
  check('a shortage never overflows the capsule', slots(G.tickCapsule(2, '', { actions: 9 })), '.ss');
}

// ================= why an Action does not fit, as a stable name =================
// The pad shows a word or two for these (pad.ts fitShort), so the verdict names
// the rule rather than leaving a page to read the sentence.
{
  const fresh = Y.newOpportunity(1);
  const code = (o, a, key) => T.canPerform(o, a, key).code;
  check('no Ticks at all', code(T.spendAction(T.spendManeuver(fresh), medium), short), 'noTicks');
  check('too few for the cost', code(T.spendAction(T.spendManeuver(fresh), short), medium), 'cost');
  check('a Long Action after a Maneuver', code(T.spendManeuver(fresh), long), 'long');
  check('the same Part twice', code(T.spendAction(T.spendManeuver(fresh), short), short), 'repeat');
  check('a Starting Action off the dial', code({ ...fresh, timing: 'melee' }, short), 'dial');
  check('and one that fits has none', T.canPerform(fresh, short).code, undefined);
}

// ================= the engine's record =================
function freeTable() {
  return U.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
}
function guidedTable() {
  return {
    v: 3, map: '', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
const mech = (s, side = 's1') => { const t = { ...U.makeMechToken(s, data, L(), side), col: 3, row: 3, statuses: [], log: [] }; s.tokens.push(t); return t; };
const drone = (s, side = 's1') => { const t = { ...U.makeDroneToken(s, data, data.byId.get('ZHDR-206'), side), col: 9, row: 9, statuses: [], log: [] }; s.tokens.push(t); return t; };
const send = (s, cmd) => { const v = M.check(data, s, cmd); if (v.ok) M.apply(data, s, cmd); return v; };
const marks = { maneuver: 0, action: 1, maneuvered: true, moved: true, started: true, performed: ['041_A'], spentExtras: [] };
{
  const s = freeTable();
  const t = mech(s);
  check('a free table is not a guided game', [!!s.script, !!s.setup], [true, false]);
  check('a Mech\'s marks are taken', send(s, { kind: 'setFreeTicks', seat: 's1', uid: t.uid, ticks: marks }).ok, true);
  check('and kept on the Mech', t.freeTicks, marks);
  send(s, { kind: 'setFreeTicks', seat: 's1', uid: t.uid, ticks: { ...marks, action: 99, performed: ['a', 7, null] } });
  check('a record is normalised on the way in', [t.freeTicks.action, t.freeTicks.performed], [9, ['a']]);
  send(s, { kind: 'setFreeTicks', seat: 's1', uid: t.uid, ticks: null });
  check('null refills them', 'freeTicks' in t, false);
  check('junk is refused', send(s, { kind: 'setFreeTicks', seat: 's1', uid: t.uid, ticks: 'lots' }).ok, false);
  check('only the owner marks its Mech', send(s, { kind: 'setFreeTicks', seat: 's2', uid: t.uid, ticks: marks }).ok, false);
  const d = drone(s);
  check('a Drone has no Ticks to mark', send(s, { kind: 'setFreeTicks', seat: 's1', uid: d.uid, ticks: marks }).ok, false);
  const g = guidedTable();
  const gt = mech(g);
  check('a guided game counts its own Ticks, so a hand mark is refused',
    /counted as each Action is performed/.test(M.check(data, g, { kind: 'setFreeTicks', seat: 's1', uid: gt.uid, ticks: marks }).why ?? ''), true);
}
{
  // Every path that starts the Opportunities over clears the marks.
  const marked = (phase) => {
    const s = freeTable();
    s.round.phase = phase;
    const t = mech(s);
    send(s, { kind: 'setFreeTicks', seat: 's1', uid: t.uid, ticks: marks });
    return { s, t };
  };
  let x = marked(1);
  send(x.s, { kind: 'advancePhase', seat: 's1' });
  check('turning into the Action Phase refills them', [x.s.round.phase, 'freeTicks' in x.t], [2, false]);
  x = marked(2);
  send(x.s, { kind: 'advancePhase', seat: 's1' });
  check('turning out of it keeps them, for the rest of the round', [x.s.round.phase, 'freeTicks' in x.t], [3, true]);
  x = marked(5);
  send(x.s, { kind: 'advancePhase', seat: 's1' });
  check('a new round refills them', [x.s.round.n, 'freeTicks' in x.t], [2, false]);
  x = marked(1);
  send(x.s, { kind: 'setPhase', seat: 's1', phase: 2 });
  check('setting the phase forward into Action refills them', 'freeTicks' in x.t, false);
  x = marked(3);
  send(x.s, { kind: 'setPhase', seat: 's1', phase: 2 });
  check('stepping back into Action is a correction, and keeps them', 'freeTicks' in x.t, true);
  x = marked(3);
  send(x.s, { kind: 'resetRounds', seat: 's1' });
  check('starting the rounds over refills them', 'freeTicks' in x.t, false);
  // A match starts from a free table and ends from a running one. A running one
  // never takes a hand mark, so the stale record is set directly: that is
  // exactly what these resets guard against.
  for (const kind of ['endMatch', 'startMatch']) {
    const g = kind === 'endMatch' ? guidedTable() : freeTable();
    const gt = mech(g);
    gt.freeTicks = { ...marks };
    const v = send(g, { kind, seat: 's1' });
    // Read back by uid: startMatch rebuilds each unit from its loadout (audit
    // Phase 6, A4), so the object held here is not the one on the table.
    const now = g.tokens.find((x) => x.uid === gt.uid);
    check(`${kind} refills them`, [v.ok, 'freeTicks' in now], [true, false]);
  }
}
{
  // The pad's Shutdown tile on a free table: Shutdown is never chosen (3.4.2),
  // so the tile sends the forcing card's own command, aimed at the Mech itself.
  const s = freeTable();
  const t = mech(s);
  check('a free table may not choose Shutdown as a Stance', send(s, { kind: 'setStance', seat: 's1', uid: t.uid, stance: 'shutdown' }).ok, false);
  check('but may mark its own Mech Shut Down, as a forced Shutdown', [send(s, { kind: 'forceShutdown', seat: 's1', uid: t.uid, targetUid: t.uid }).ok, t.stance], [true, 'shutdown']);
  check('and not twice', send(s, { kind: 'forceShutdown', seat: 's1', uid: t.uid, targetUid: t.uid }).ok, false);
}
{
  // migrateState keeps only a token that stands somewhere, so the fixture has a cell.
  const saved = (freeTicks) => U.migrateState({ v: 3, nextUid: 2, round: { n: 1, phase: 2, firstPlayer: 's1' },
    tokens: [{ ...U.makeMechToken(freeTable(), data, L(), 's1'), uid: 1, col: 3, row: 3, freeTicks }] }, data);
  check('a reload keeps the marks, through their whitelist', saved({ ...marks, action: -3 }).tokens[0].freeTicks, { ...marks, action: 0 });
  check('and drops a record that is not one', saved('x').tokens[0].freeTicks, undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
