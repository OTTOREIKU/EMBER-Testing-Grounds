// The Electronic Counter-roll's answers (src/contest.ts).
//
// A Counter-roll (4.11) is a record both seats hold, and every press on the
// window that draws it is a question one of the two seats owns, so it travels
// as a command. contestAct is the one sender of them: the Match Centre's
// window presses go through it, and so do a computer seat's. It was a function
// of matchhud.ts that only a page could run; these checks DRIVE it, on the
// real engine's units, with a table that records what was sent.
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Counter-roll\'s answers\n');

const { M, data } = await loadEngine('contest', ["export * as CON from '../src/contest';"]);
const base = tableAtRoundOne(M, data, data.solo.scenarios[0]);

// The Raven (s2) jamming the Mire (s1) with Fire Control Interference, in the
// Automatic Phase: the record open, nobody having rolled.
const table = (over = {}) => {
  const s = JSON.parse(JSON.stringify(base.state));
  s.map = 'none';
  const raven = s.tokens.find((t) => t.label.startsWith('ADK60S'));
  const mire = s.tokens.find((t) => t.label === 'Mire');
  raven.col = 18; raven.row = 12; mire.col = 15; mire.row = 12;
  s.round.phase = 3; s.script.stage = '1:3';
  s.script.counter = {
    initiatorUid: raven.uid, responderUid: mire.uid, actionId: '166_A',
    initRoll: null, respRoll: null, initFocused: false, respFocused: false, provoke: null, ...over,
  };
  return { s, raven, mire };
};
const settle = () => new Promise((r) => setTimeout(r, 5));
// One press: what it rolled, what it sent, what it said, how often it redrew.
const press = async (act, arg, opts = {}) => {
  const t = opts.table ?? table(opts.counter ?? {});
  const sent = [], said = [], rolled = [];
  let done = 0;
  M.CON.contestAct({
    data, state: t.s, seat: opts.seat ?? 's2',
    send: (cmd) => { sent.push(JSON.parse(JSON.stringify(cmd))); return (opts.refuse ?? []).includes(cmd.kind) ? { ok: false, why: `${cmd.kind} refused` } : { ok: true }; },
    rollHits: opts.dice ?? (async (n, label) => { rolled.push([n, label]); return { dice: Array.from({ length: n }, (_, i) => ({ color: 'yellow', face: 5 - i })) }; }),
    say: (text, kind) => said.push([kind ?? 'refused', text]),
    done: () => { done += 1; },
  }, act, typeof arg === 'function' ? arg(t) : arg);
  await settle();
  return { ...t, sent, kinds: sent.map((c) => c.kind), said, rolled, done };
};
const lost = async () => { throw new Error('offline'); };

// ---------- each seat rolls its own unit's dice ----------
{
  const i = await press('roll', (t) => ({ uid: t.raven.uid }));
  check('the Initiator rolls the pool its Action gives it, and the faces travel under its own seat',
    [i.rolled, i.sent], [[[3, 'rolls 3 for the Electronic Counter-roll']], [{ kind: 'rollCounter', seat: 's2', uid: i.raven.uid, faces: [5, 4, 3] }]]);
  const r = await press('roll', (t) => ({ uid: t.mire.uid }), { seat: 's1' });
  check('the Responder rolls its own Electronic Value, under its own',
    [r.rolled.map((x) => x[0]), r.sent.map((c) => [c.kind, c.seat, c.uid, c.faces])], [[2], [['rollCounter', 's1', r.mire.uid, [5, 4]]]]);
  check('and the page is told to redraw once the faces have gone', [i.done, r.done], [1, 1]);
  // The unit PERFORMING the Action counts the Loads it is borrowing (FAQ O5);
  // rolling passively it counts only its own Parts. The Wild Cat in Contact
  // with a Tarantula carrying an ECM Backpack, as each.
  const loaded = (initiator) => {
    const t = table();
    const cat = t.s.tokens.find((x) => x.label === 'Wild Cat');
    const carrier = t.s.tokens.find((x) => x.label.startsWith('ADK30C'));
    cat.col = 15; cat.row = 18; carrier.col = 18; carrier.row = 18; carrier.droneBackpack = '007';
    t.s.script.counter = { ...t.s.script.counter, actionId: 'COMMON_SCAN', initiatorUid: initiator ? cat.uid : t.mire.uid, responderUid: initiator ? t.mire.uid : cat.uid };
    return { t, cat };
  };
  const asInit = loaded(true);
  const asResp = loaded(false);
  check('the Initiator\'s pool counts the Load it borrows, the Responder\'s does not',
    [(await press('roll', { uid: asInit.cat.uid }, { table: asInit.t })).rolled.map((x) => x[0]), (await press('roll', { uid: asResp.cat.uid }, { table: asResp.t })).rolled.map((x) => x[0])],
    [[5], [4]]);
  const fail1 = await press('roll', (t) => ({ uid: t.raven.uid }), { dice: lost });
  check('dice that never come back send nothing and say so', [fail1.kinds, fail1.said, fail1.done], [[], [['system', 'The server did not answer the roll. Press it again.']], 1]);
}

// ---------- the Focus, declared and then rerolled (FAQ G4) ----------
{
  const use = await press('declare', (t) => ({ uid: t.mire.uid, use: true }), { seat: 's1' });
  check('a declare travels on its own, and says whether the side will Focus',
    use.sent, [{ kind: 'declareCounterFocus', seat: 's1', uid: use.mire.uid, use: true }]);
  check('a pass is the same command, declined', (await press('declare', (t) => ({ uid: t.raven.uid, use: false }))).sent.map((c) => [c.kind, c.use]), [['declareCounterFocus', false]]);
  check('a Whistle names the Mech whose Command Token pays',
    (await press('declare', (t) => ({ uid: t.raven.uid, use: true, whistleUid: 3 }))).sent[0].whistleUid, 3);
  const no = await press('declare', (t) => ({ uid: t.mire.uid, use: true }), { seat: 's1', refuse: ['declareCounterFocus'] });
  check('a refused declare is told to the player', no.said, [['refused', 'declareCounterFocus refused']]);

  const hands = { initRoll: [0, 1, 2], respRoll: [3, 4], initDeclare: true, respDeclare: false };
  const keep = await press('focus', (t) => ({ uid: t.raven.uid, indices: [] }), { counter: hands });
  check('keeping the roll closes that side\'s reroll with the faces it had, and throws nothing',
    [keep.rolled, keep.sent], [[], [{ kind: 'rollCounter', seat: 's2', uid: keep.raven.uid, faces: [0, 1, 2], focused: true }]]);
  const re = await press('focus', (t) => ({ uid: t.raven.uid, indices: [2, 0] }), { counter: hands });
  check('a reroll throws only the dice that were picked, and splices them back where they were',
    [re.rolled.map((x) => x[0]), re.sent[0].faces, re.sent[0].focused], [[2], [4, 1, 5], true]);
  check('the Link was paid at the declare: the reroll sends no payment',
    re.kinds, ['rollCounter']);
  check('an index off the hand is dropped; with none left it is a kept roll',
    (await press('focus', (t) => ({ uid: t.raven.uid, indices: [9] }), { counter: hands })).sent.map((c) => [c.faces, c.focused]), [[[0, 1, 2], true]]);
  check('a side that has not rolled has nothing to reroll', (await press('focus', (t) => ({ uid: t.raven.uid, indices: [0] }))).kinds, []);
  const off = await press('focus', (t) => ({ uid: t.mire.uid, indices: [1] }), { seat: 's1', counter: hands, dice: lost });
  check('a failed Focus reroll is told to the player, with what a retry costs',
    [off.kinds, off.said.map((x) => x[0]), /the Link is already paid, and a retry costs nothing more/.test(off.said[0][1])], [[], ['system'], true]);
}

// ---------- the win is the Initiator's to apply ----------
{
  const t0 = table();
  const action = M.U.ownCards(data, t0.raven).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === '166_A');
  const win = M.U.ewWinCommands(data, t0.raven, t0.mire, action, { reaction: false, thenAttack: undefined, terminal: undefined });
  const ap = await press('apply');
  check('a win sends every effect of the Action, as the shared reading builds them, then closes the record',
    [win.cmds.length > 0, ap.kinds, ap.sent.slice(0, -1), ap.sent[ap.sent.length - 1]],
    [true, [...win.cmds.map((c) => c.kind), 'clearCounterRoll'], JSON.parse(JSON.stringify(win.cmds)), { kind: 'clearCounterRoll', seat: 's2' }]);
  check('and says what it did', [ap.said.length, ap.said[0][0], ap.said[0][1].startsWith(`${ap.raven.label} succeeds`)], [1, 'done', true]);
  const half = await press('apply', undefined, { refuse: [win.cmds[0].kind] });
  check('an effect the engine refused is not announced as done, and the record still closes',
    [half.said, half.kinds[half.kinds.length - 1]], [[], 'clearCounterRoll']);
  const gone = await press('apply', undefined, { counter: { actionId: 'nope' } });
  check('an Action nobody can find applies nothing: the record is closed', gone.kinds, ['clearCounterRoll']);
}

// ---------- closing it ----------
{
  const c = await press('close', undefined, { seat: 's1' });
  check('the close travels under the seat that pressed it', c.sent, [{ kind: 'clearCounterRoll', seat: 's1' }]);
  const no = await press('close', undefined, { seat: 's1', refuse: ['clearCounterRoll'] });
  check('a refused close says why and ends nothing', no.said, [['refused', 'clearCounterRoll refused']]);
  const scan = await press('close', undefined, { counter: { actionId: 'COMMON_SCAN', thenAttack: { actionId: '536_A' } } });
  check('a free Scan closed unapplied ends the attack that earned it, and says so once the close has landed (FAQ I11)',
    [scan.kinds, scan.said.length, /its attack on .* ends\. The Action Tick is spent/.test(scan.said[0][1])], [['clearCounterRoll'], 1, true]);
  const still = await press('close', undefined, { counter: { actionId: 'COMMON_SCAN', thenAttack: { actionId: '536_A' } }, refuse: ['clearCounterRoll'] });
  check('but not when the close was refused', still.said.map((x) => x[1]), ['clearCounterRoll refused']);
  // A Multi-Target's extra designation: its Scan failed while the target is
  // still hidden, and only that designation falls.
  const hidden = table({ actionId: 'COMMON_SCAN', thenAttack: { actionId: '536_A', extra: true } });
  hidden.mire.statuses = ['camouflage'];
  const extra = await press('close', undefined, { table: hidden });
  check('a Multi-Target\'s extra designation drops only itself', /cannot designate .*\. Its other targets stand \(FAQ I11\)/.test(extra.said[0]?.[1] ?? ''), true);
  const shown = table({ actionId: 'COMMON_SCAN', thenAttack: { actionId: '536_A', extra: true } });
  check('and one whose target has appeared was applied: nothing is said', (await press('close', undefined, { table: shown })).said, []);
}

// ---------- Yoyu's Provoke (LPA-22) ----------
{
  const p = await press('provoke', (t) => ({ uid: t.raven.uid }));
  check('Yoyu is whichever side the window named, and the answer is its seat\'s',
    p.sent, [{ kind: 'provoke', seat: 's2', uid: p.raven.uid, targetUid: p.mire.uid, take: true }]);
  const q = await press('provokepass', (t) => ({ uid: t.mire.uid }), { seat: 's1' });
  check('a decline travels too, so the question closes on both screens',
    q.sent, [{ kind: 'provoke', seat: 's1', uid: q.mire.uid, targetUid: q.raven.uid, take: false }]);
  check('each says how it went', [p.said[0][0], /provokes/.test(p.said[0][1]), /leaves .* Stance alone/.test(q.said[0][1])], ['done', true, true]);
  const no = await press('provoke', (t) => ({ uid: t.raven.uid }), { refuse: ['provoke'] });
  check('and a refusal says why', [no.said[0][0], /cannot provoke .*: provoke refused/.test(no.said[0][1])], ['refused', true]);
}

// ---------- a record with nobody behind it ----------
{
  const none = table();
  none.s.script.counter = null;
  check('with no Counter-roll on the table a press sends nothing', (await press('roll', { uid: 1 }, { table: none })).kinds, []);
  const orphan = table({ responderUid: 999 });
  check('a record whose unit is gone is closed, not answered', (await press('roll', { uid: orphan.raven.uid }, { table: orphan, seat: 's1' })).sent, [{ kind: 'clearCounterRoll', seat: 's1' }]);
}

// ---------- a Remote Access: the Terminal's stand-in (ruling I25) ----------
{
  const t = table();
  const tasks = M.TK.normaliseTasks(t.s.tasks);
  tasks.items = [...tasks.items, { id: 'term-1', kind: 'terminal', zone: 'Bravo', col: 16, row: 16 }];
  t.s.tasks = tasks;
  t.s.script.counter = { ...t.s.script.counter, initiatorUid: t.mire.uid, responderUid: M.TK.TERMINAL_UID, actionId: 'COMMON_REMOTE_ACCESS', terminal: 'term-1' };
  const stand = M.CON.counterResponder(data, t.s, t.s.script.counter, t.mire);
  check('the Responder of a Remote Access is the Terminal\'s stand-in, on the other squad\'s side, where its token stands',
    [stand.uid, stand.side, stand.col, stand.row, /Terminal$/.test(stand.label)], [M.TK.TERMINAL_UID, 's2', 16, 16, true]);
  check('for an ordinary Counter-roll it is the unit', M.CON.counterResponder(data, table().s, table().s.script.counter, table().raven).label, 'Mire');
  const roll = await press('roll', { uid: M.TK.TERMINAL_UID }, { table: t, seat: 's2' });
  check('the Terminal\'s hand is the opponent\'s to roll, as a table command, at its own Electronic Value',
    [roll.rolled.map((x) => x[0]), roll.sent], [[M.TK.TERMINAL_EV], [{ kind: 'rollTerminal', seat: 's2', faces: [5, 4, 3] }]]);
  const lostItem = { ...t.s.script.counter, terminal: 'no-such' };
  t.s.script.counter = lostItem;
  check('a Terminal that is gone leaves no Responder', M.CON.counterResponder(data, t.s, lostItem, t.mire) ?? null, null);
}

// ---------- the Match Centre sends through it ----------
{
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hud = src('matchhud.ts'), con = src('contest.ts');
  check('the window\'s presses are sent by contestAct, with the page\'s own seat, send, dice, notice line and redraw',
    /sendContestAct\(\{\s*data: ctx\.data, state: ctx\.state, seat: seatOf\(ctx\), send: ctx\.send, rollHits: ctx\.rollHits,\s*say: \(text, kind\) => ctx\.noteNow\(text, kind\), done: \(\) => ctx\.refresh\(\),\s*\}, act, arg\);/.test(hud), true);
  check('and the page keeps no second sender of them',
    /kind: 'rollCounter'|kind: 'declareCounterFocus'|kind: 'rollTerminal'|kind: 'provoke'/.test(hud), false);
  check('its Responder is read by the same function', /return contestResponder\(ctx\.data, ctx\.state, c, init\);/.test(hud), true);
  const imports = [...con.matchAll(/from '\.\/(\w+)'/g)].map((m) => m[1]).sort();
  check('contest.ts imports the rules and nothing with a page in it (of the window, its types only)',
    [imports, /import type \{ EwAct, EwArg \} from '\.\/combat';/.test(con), /\bdocument\.|\bwindow\./.test(con)],
    [['combat', 'commands', 'data', 'tasks', 'turn', 'types', 'types', 'units'], true, false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
