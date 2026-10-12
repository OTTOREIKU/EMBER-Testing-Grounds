// The pad's Electronic Counter-roll presses (pad/ew.ts).
//
// On a Guided table the record lives in `script.counter`, both phones draw it,
// and every press on the window travels as a command, as on the Match Centre
// (contest.test.mjs drives that sender). These checks DRIVE the pad's presses
// through the real pad module, on the real engine's units, with a phone that
// records what it sent, what it rolled and what it said (the code audit,
// 2026-10-12: nothing ran this path before).
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The pad\'s Counter-roll presses\n');

const { M, data } = await loadEngine('padew', ["export * as EW from '../pad/ew';"]);
const base = tableAtRoundOne(M, data, data.solo.scenarios[0]);

// The Raven (s2) jamming the Mire (s1) with Fire Control Interference, in the
// Automatic Phase: the record open, nobody having rolled. As contest.test.mjs.
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

// The phone: what it sent, rolled and said, and how often it redrew.
let phone = null;
M.EW.initEw({
  data,
  state: () => phone.t.s,
  me: () => phone.seat,
  solo: false,
  inRoom: () => true,
  send: (cmd) => { phone.sent.push(JSON.parse(JSON.stringify(cmd))); return !phone.refuse.includes(cmd.kind); },
  toast: (text, kind) => { phone.said.push([kind ?? 'done', text]); },
  render: () => { phone.renders += 1; },
  openCombat: () => {},
  closeCombat: () => {},
  rollFaces: async (n, label) => { phone.rolled.push([n, label]); return phone.dice(n); },
});
const helper = M.EW.mountEw(document.createElement('div'));
const settle = () => new Promise((r) => setTimeout(r, 5));
const press = async (act, arg, opts = {}) => {
  const t = opts.table ?? table(opts.counter ?? {});
  phone = { t, seat: opts.seat ?? 's2', sent: [], said: [], rolled: [], renders: 0, refuse: opts.refuse ?? [],
    dice: opts.dice ?? ((n) => Array.from({ length: n }, (_, i) => 5 - i)) };
  helper.contestAct(act, typeof arg === 'function' ? arg(t) : arg);
  await settle();
  return { ...t, sent: phone.sent, kinds: phone.sent.map((c) => c.kind), said: phone.said, rolled: phone.rolled, renders: phone.renders };
};

check('the pad\'s Counter-roll window is mounted, and its presses are the pad\'s own', [!!helper, typeof helper.contestAct], [true, 'function']);

// ---------- each phone rolls its own unit's dice ----------
{
  const i = await press('roll', (t) => ({ uid: t.raven.uid }));
  check('the Initiator rolls the pool its Action gives it, named for the unit, and the faces travel under its own seat',
    [i.rolled, i.sent], [[[3, `${i.raven.label}: Electronic Counter-roll`]], [{ kind: 'rollCounter', seat: 's2', uid: i.raven.uid, faces: [5, 4, 3] }]]);
  const r = await press('roll', (t) => ({ uid: t.mire.uid }), { seat: 's1' });
  check('the Responder rolls its own Electronic Value, under its own',
    [r.rolled.map((x) => x[0]), r.sent.map((c) => [c.kind, c.seat, c.uid, c.faces])], [[2], [['rollCounter', 's1', r.mire.uid, [5, 4]]]]);
  const short = await press('roll', (t) => ({ uid: t.raven.uid }), { dice: () => [] });
  check('dice that never come back send nothing', short.kinds, []);
}

// ---------- the Focus, declared and then rerolled (FAQ G4) ----------
{
  const use = await press('declare', (t) => ({ uid: t.mire.uid, use: true }), { seat: 's1' });
  check('a declare travels on its own, and says whether the side will Focus',
    use.sent, [{ kind: 'declareCounterFocus', seat: 's1', uid: use.mire.uid, use: true }]);
  check('a Whistle names the Mech whose Command Token pays',
    (await press('declare', (t) => ({ uid: t.raven.uid, use: true, whistleUid: 3 }))).sent[0].whistleUid, 3);
  const hands = { initRoll: [0, 1, 2], respRoll: [3, 4], initDeclare: true, respDeclare: false };
  const keep = await press('focus', (t) => ({ uid: t.raven.uid, indices: [] }), { counter: hands });
  check('keeping the roll closes that side\'s reroll with the faces it had, and throws nothing',
    [keep.rolled, keep.sent], [[], [{ kind: 'rollCounter', seat: 's2', uid: keep.raven.uid, faces: [0, 1, 2], focused: true }]]);
  const re = await press('focus', (t) => ({ uid: t.raven.uid, indices: [2, 0] }), { counter: hands });
  check('a reroll throws only the dice that were picked, named for the unit, and splices them back where they were',
    [re.rolled, re.sent[0].faces, re.sent[0].focused, re.kinds], [[[2, `${re.raven.label}: Focus reroll`]], [4, 1, 5], true, ['rollCounter']]);
  check('a side that has not rolled has nothing to reroll', (await press('focus', (t) => ({ uid: t.raven.uid, indices: [0] }))).kinds, []);
}

// ---------- Yoyu's Provoke, either way (4.11.2) ----------
{
  const take = await press('provoke', (t) => ({ uid: t.mire.uid }), { seat: 's1' });
  check('a Provoke is sent by Yoyu\'s side, at the other unit', take.sent, [{ kind: 'provoke', seat: 's1', uid: take.mire.uid, targetUid: take.raven.uid, take: true }]);
  const pass2 = await press('provokepass', (t) => ({ uid: t.raven.uid }));
  check('and a pass is the same command, declined', pass2.sent.map((c) => [c.kind, c.uid, c.take]), [['provoke', pass2.raven.uid, false]]);
  // Said since the pad sends through contest.ts (the code audit, 2026-10-12).
  check('and the phone is told what was done',
    [take.said, pass2.said], [[['done', `${take.mire.label} provokes ${take.raven.label} into Offensive Stance (LPA-22 Yoyu).`]], [['done', `${pass2.raven.label} leaves ${pass2.mire.label}'s Stance alone.`]]]);
  const no = await press('provoke', (t) => ({ uid: t.mire.uid }), { seat: 's1', refuse: ['provoke'] });
  check('a refusal is told once, by the pad\'s own send, and not a second time here', no.said, []);
}

// ---------- the win is the Initiator's to apply ----------
{
  const t0 = table();
  const action = M.U.ownCards(data, t0.raven).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === '166_A');
  const win = M.U.ewWinCommands(data, t0.raven, t0.mire, action, { reaction: false, thenAttack: undefined, terminal: undefined });
  const ap = await press('apply');
  check('a win sends every effect of the Action, as the shared reading builds them, then closes the record',
    ap.kinds, [...win.cmds.map((c) => c.kind), 'clearCounterRoll']);
  check('as one tap for Undo: every command after the first joins it', ap.sent.map((c) => c.chain ?? null), ap.sent.map((_c, i) => (i ? 'join' : null)));
  check('and the phone is told what was applied', ap.said, [['done', `${ap.raven.label} succeeds: ${win.lines.join('; ')}.`]]);
}

// ---------- a lent Pod (FAQ O5) ----------
// The EC50 Electronic Warfare Pod (089) lent by a Tarantula: the pad has no
// board to judge Contact on, so the table judged it, and the Pod's Action is
// found wherever the carrier stands. Its win must still be applied.
{
  const t = table();
  const cat = t.s.tokens.find((x) => x.label === 'Wild Cat');
  const carrier = t.s.tokens.find((x) => x.label.startsWith('ADK30C'));
  const foe = t.s.tokens.find((x) => x.side !== cat.side && x.kind === 'mech');
  cat.col = 3; cat.row = 3; carrier.col = 30; carrier.row = 30; carrier.droneBackpack = '089';
  t.s.script.counter = { ...t.s.script.counter, actionId: '089_A', initiatorUid: cat.uid, responderUid: foe.uid };
  const pod = M.U.loanedParts(data, t.s.tokens, cat, { anywhere: true }).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === '089_A');
  const win = M.U.ewWinCommands(data, cat, foe, pod, { reaction: false, thenAttack: undefined, terminal: undefined });
  const ap = await press('apply', undefined, { table: t, seat: cat.side });
  check('a Pod lent across the table is found, and its win applied',
    [!!pod, win.cmds.length > 0, ap.kinds], [true, true, [...win.cmds.map((c) => c.kind), 'clearCounterRoll']]);
}

// ---------- closing ----------
{
  const c = await press('close', undefined, { seat: 's1' });
  check('a close is sent by the phone that pressed it', c.sent, [{ kind: 'clearCounterRoll', seat: 's1' }]);
  // A free Scan's attack ends with a Scan that was not applied (FAQ I11), and
  // the pad says so since it sends through contest.ts.
  const scan = await press('close', undefined, { counter: { actionId: 'COMMON_SCAN', thenAttack: { actionId: 'x' } } });
  check('closing a free Scan that was not applied ends its attack, and says so',
    [scan.kinds, scan.said.length, /its attack on .* ends\. The Action Tick is spent; any remaining Ticks may still be used \(FAQ I11\)/.test(scan.said[0]?.[1] ?? '')], [['clearCounterRoll'], 1, true]);
  const gone = table();
  gone.s.tokens = gone.s.tokens.filter((t) => t.uid !== gone.mire.uid);
  const g = await press('roll', { uid: gone.raven.uid }, { table: gone });
  check('a record whose unit has left the table is closed instead', g.sent, [{ kind: 'clearCounterRoll', seat: 's2' }]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
