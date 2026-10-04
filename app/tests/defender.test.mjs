// The defender's answers (src/defender.ts).
//
// Every question an attack puts to the defending player is answered by a
// command, and defenderAct is the one sender of them: the Match Centre's
// mirror presses go through it, and so do a computer seat's. These checks used
// to be pins on match.ts's wording; the function can be driven now, so they
// are driven. The rule they hold is the one that cost a free KC Armor, a free
// Melee Evasion and a free Focus advance when it was missing: THE COST GATES
// THE DECLARE. A refused spend sends no declaration.
import { readFileSync } from 'node:fs';
import { loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The defender\'s answers\n');

const { M, data } = await loadEngine('defender', ["export * as DEF from '../src/defender';"]);

// An attack on the table: unit 1 of s1 shooting unit 2 of s2, the defence roll
// asked for (two White, one Blue) and, for the reroll, already on the table.
const table = (over = {}) => {
  const s = { tokens: [], nextUid: 1 };
  const atk = M.U.makeMechToken(s, data, { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' }, 's1');
  // The Gray Wolf's KC Experimental Core, Charged: KC Armor is on offer.
  const def = { ...M.U.makeMechToken(s, data, { torso: '093', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' }, 's2'), charge: ['torso'] };
  return {
    tokens: [atk, def],
    script: {
      combat: { attackerUid: atk.uid, targetUid: def.uid, actionId: '536_A', white: 2, blue: 1 },
      combatView: { attackerUid: atk.uid, targetUid: def.uid, actionId: '536_A', mode: 'attack', step: 'defense',
        defense: [{ color: 'white', face: 0 }, { color: 'white', face: 1 }, { color: 'blue', face: 2 }] },
      ...over,
    },
  };
};
const settle = () => new Promise((r) => setTimeout(r, 5));
// One press: what it sent, what it said, whether it went.
const press = async (act, arg, opts = {}) => {
  const sent = [], said = [];
  const state = opts.state ?? table();
  const went = M.DEF.defenderAct({
    data, state, seat: opts.seat ?? 's2',
    send: (cmd) => { sent.push(cmd); return (opts.refuse ?? []).includes(cmd.kind) ? { ok: false, why: `${cmd.kind} refused` } : { ok: true }; },
    roll: opts.roll ?? (async (white, blue) => [...Array.from({ length: white }, (_, i) => ({ color: 'white', face: 4 + i })), ...Array.from({ length: blue }, () => ({ color: 'blue', face: 5 }))]),
    say: (kind, text) => said.push([kind, text]),
  }, act, arg);
  await settle();
  return { went, kinds: sent.map((c) => c.kind), sent, said };
};

// ---------- the cost gates the declare ----------
for (const [act, cost, declare] of [
  ['focususe', 'focus', 'focusAnswer'],
  ['kcarmor', 'setCharge', 'kcArmor'],
  ['meleeevade', 'spendCommand', 'meleeEvade'],
  ['dodgeenhance', 'spendCommand', 'dodgeEnhance'],
]) {
  const paid = await press(act);
  check(`${act}: the cost is sent first, then the declaration`, [paid.went, paid.kinds], [true, [cost, declare]]);
  const refused = await press(act, undefined, { refuse: [cost] });
  check(`${act}: a refused cost sends no declaration, says why, and reports that nothing went`,
    [refused.went, refused.kinds, refused.said], [false, [cost], [['refused', `${cost} refused`]]]);
}
{
  const p = await press('focususe');
  check('the Focus is paid by the unit being shot at, and the answer says it was used',
    p.sent.map((c) => [c.kind, c.seat, c.uid ?? null, c.use ?? null]), [['focus', 's2', 2, null], ['focusAnswer', 's2', null, true]]);
  const kc = await press('kcarmor');
  check('KC Armor spends the Charge Token of the Part that carries it',
    [kc.sent[0].slot, kc.sent[0].on, kc.sent[0].uid], ['torso', false, 2]);
  const plain = table();
  plain.tokens[1].charge = [];
  check('with no Charge Token to spend there is no KC Armor to declare', (await press('kcarmor', undefined, { state: plain })), { went: false, kinds: [], sent: [], said: [] });
}

// ---------- the answers that cost nothing ----------
{
  const p = await press('focuspass');
  check('passing sends the one answer', [p.went, p.sent.map((c) => [c.kind, c.use])], [true, [['focusAnswer', false]]]);
  check('and reports a refusal of it', (await press('focuspass', undefined, { refuse: ['focusAnswer'] })).went, false);
  const k = await press('focuskeep');
  check('keeping the roll is an empty reroll', [k.went, k.sent.map((c) => [c.kind, c.indices, c.faces])], [true, [['focusReroll', [], []]]]);
  const d = await press('designate', 'leftHand');
  check('a designation names its Part', [d.went, d.sent.map((c) => [c.kind, c.slot])], [true, [['designateHit', 'leftHand']]]);
  check('and one with no Part named sends nothing', (await press('designate', undefined)).kinds, []);
}

// ---------- the dice ----------
{
  const r = await press('rolldefense');
  check('the defence roll is the pool that was asked for, sent as the answer',
    [r.went, r.sent.map((c) => [c.kind, c.faces.map((f) => `${f.color}${f.face}`)])], [true, [['answerDefense', ['white4', 'white5', 'blue5']]]]);
  const answered = table();
  answered.script.combat.faces = [{ color: 'white', face: 1 }];
  check('a roll already answered is not rolled again', (await press('rolldefense', undefined, { state: answered })).kinds, []);
  const none = table();
  none.script.combat = null;
  check('nor one that was never asked for', [(await press('rolldefense', undefined, { state: none })).went], [false]);
  const lost = await press('rolldefense', undefined, { roll: async () => { throw new Error('offline'); } });
  check('dice that never come back record nothing and say so', [lost.kinds, lost.said.map((x) => x[0])], [[], ['system']]);
}
{
  const r = await press('focusreroll', [2, 0]);
  check('a reroll throws one die for each picked, of its own colour, and sends them in index order',
    r.sent.map((c) => [c.kind, c.indices, c.faces.map((f) => `${f.color}${f.face}`)]), [['focusReroll', [0, 2], ['white4', 'blue5']]]);
  check('an index off the table is dropped, and an empty pick sends nothing',
    [(await press('focusreroll', [9])).kinds, (await press('focusreroll', [])).went], [[], false]);
  const lost = await press('focusreroll', [1], { roll: async () => { throw new Error('offline'); } });
  check('a failed Focus reroll is told to the player, not swallowed',
    [lost.kinds, lost.said.length, /reroll again/.test(lost.said[0]?.[1] ?? '')], [[], 1, true]);
}

// ---------- only the defending player answers ----------
{
  check('the attacking seat is sent nothing through here', [(await press('focususe', undefined, { seat: 's1' })).kinds, (await press('rolldefense', undefined, { seat: 's1' })).went], [[], false]);
  const quiet = table();
  quiet.script.combatView = null;
  check('nor is anything sent with no attack on the table', (await press('focuspass', undefined, { state: quiet })).kinds, []);
}

// ---------- the Match Centre sends through it ----------
{
  const page = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('the mirror\'s presses are sent by defenderAct, with the page\'s own send, dice and notice line',
    /return defenderAct\(\{ data, state, seat, send, roll: rollDefensePool, say, done: render \}, act, arg\);/.test(page), true);
  check('and the page keeps no second sender of them', /kind: 'focusAnswer'|kind: 'kcArmor'|kind: 'meleeEvade'|kind: 'dodgeEnhance'|kind: 'designateHit'/.test(page), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
