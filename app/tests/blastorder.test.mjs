// Simultaneous damage (Supplementary Rules 1.04, 1.9; OTTO, 2026-09-30): "If
// there are multiple damage sources belonging to different players, the
// current initiative player determines the order in a round-robin manner" -
// and the First Player passes every round, so the initiative is this round's
// First Player. Each squad orders its own. Driven through the real engine.
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

console.log('Simultaneous damage: the round-robin (1.9)\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_blastorder.entry.ts', import.meta.url);
const out = new URL('./_blastorder.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { check, apply } from '../src/commands';",
  "export { minesOwed, blastTurn, blastsReady, jumpsToTarget, fliesToTarget, detonationBar, migrateState } from '../src/units';",
  "export { boardFingerprint } from '../src/secrecy';",
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

// GM-35 Mines (card 074) and a Ground Mech in one Large Grid (cells 3 to 5):
// every Mine there is owed at once, whoever laid it (FAQ M6, I13).
const mineAt = (uid, side, col, row) => ({ uid, side, kind: 'projectile', cardId: '074', label: `Mine ${uid}`, col, row, facing: 0, size: 1,
  aerial: true, deployed: true, statuses: [], log: [], ammo: {}, partStates: { main: 'intact' } });
const walker = { uid: 90, side: 's1', kind: 'mech', cardId: '012', label: 'Walker', col: 4, row: 4, facing: 0, size: 3, stance: 'offensive', link: 3,
  deployed: true, statuses: [], log: [], ammo: {}, partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' },
  mech: { torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2' } };
const table = (mines, first) => ({ v: 3, map: '', tokens: [...mines, { ...walker }], nextUid: 100, round: { n: 2, phase: 2, firstPlayer: first }, commandTokens: { s1: 0, s2: 0 } });
const owedBy = (s) => U.minesOwed(data, s.tokens).map((m) => s.tokens.find((t) => t.uid === m.uid)?.side).sort();
const done = (s, uid) => {
  const side = s.tokens.find((t) => t.uid === uid)?.side;
  const cmd = { kind: 'despawn', seat: side, uid, targetUid: uid };
  const v = U.check(data, s, cmd);
  if (v.ok) U.apply(data, s, cmd);
  return v;
};

// ---------- one each ----------
const one = table([mineAt(1, 's1', 3, 3), mineAt(2, 's2', 5, 5)], 's2');
check('both squads owe a blast at once', owedBy(one), ['s1', 's2']);
check('this round\'s First Player resolves first', U.blastTurn(data, one), 's2');
const early = done(one, 1);
check('the other squad\'s blast is refused until then, and says why',
  [early.ok, /Supplementary Rules 1\.04, 1\.9/.test(early.why ?? ''), /First Player/.test(early.why ?? '')], [false, true, true]);
check('its damage is refused too',
  U.check(data, one, { kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 90, slot: 'torso' }).ok, false);
check('the First Player\'s goes', done(one, 2).ok, true);
check('then the other squad\'s', [U.blastTurn(data, one), done(one, 1).ok], ['s1', true]);
check('and with nothing owed the turn is forgotten', ['blastLast' in one, U.blastTurn(data, one)], [false, null]);

// ---------- two each: they alternate ----------
const two = table([mineAt(1, 's1', 3, 3), mineAt(3, 's1', 3, 4), mineAt(2, 's2', 5, 5), mineAt(4, 's2', 5, 4)], 's1');
const order = [];
for (let i = 0; i < 4; i++) {
  const turn = U.blastTurn(data, two);
  const next = U.minesOwed(data, two.tokens).find((m) => two.tokens.find((t) => t.uid === m.uid)?.side === turn);
  order.push(`${turn}:${done(two, next.uid).ok}`);
}
check('two each go round-robin from the First Player: s1, s2, s1, s2', order, ['s1:true', 's2:true', 's1:true', 's2:true']);

// ---------- a squad with none left stands aside ----------
const uneven = table([mineAt(1, 's1', 3, 3), mineAt(2, 's2', 5, 5), mineAt(4, 's2', 5, 4)], 's1');
done(uneven, 1);
check('once one squad has none left the other resolves the rest', [U.blastTurn(data, uneven), done(uneven, 2).ok, done(uneven, 4).ok], ['s2', true, true]);

// ---------- the next round, the other squad first ----------
check('the initiative follows the round the blasts go off in',
  U.blastTurn(data, table([mineAt(1, 's1', 3, 3), mineAt(2, 's2', 5, 5)], 's1')), 's1');

// ---------- one squad alone owes no order ----------
const alone = table([mineAt(1, 's1', 3, 3), mineAt(3, 's1', 3, 4)], 's2');
check('a squad alone orders its own as it likes', [U.blastTurn(data, alone), done(alone, 3).ok, done(alone, 1).ok], ['s1', true, true]);

// ---------- it travels ----------
check('migrateState keeps whose turn it was, and nothing else',
  [U.migrateState({ ...table([], 's1'), blastLast: 's2' }, data).blastLast, U.migrateState({ ...table([], 's1'), blastLast: 'x' }, data).blastLast],
  ['s2', undefined]);
check('a drift in it is a desync the fingerprint sees',
  U.boardFingerprint({ ...table([], 's1'), blastLast: 's1' }) === U.boardFingerprint(table([], 's1')), false);

// ---------- the Pholcus jumps in: 1.9's special case ----------
// "The Pholcus' entry-trigger effect is resolved first, followed by the
// simultaneous detonation of Mines A and B", and a Mine it destroyed never goes
// off. Its blast takes its TARGET alone: the English card, which OTTO ruled
// the standard where the Chinese says every unit in the Grid (2026-09-30).
const act = (id, aid) => (data.byId.get(id)?.actions ?? []).find((a) => a.id === aid);
check('the Unfolded Pholcus jumps to its target, and a Missile flies',
  [U.jumpsToTarget(act('167', '167_A')), U.fliesToTarget(act('167', '167_A')), U.jumpsToTarget(act('071', '071_A')), U.fliesToTarget(act('071', '071_A'))],
  [true, false, false, true]);
// Laid together (one batch), so they sit quiet side by side until something
// enters: a Mine placed later would set the older one off (FAQ M6; 1.3).
const mineOf = (uid, side, col, row) => ({ ...mineAt(uid, side, col, row), mine: { batch: 'laid' } });
const pholcus = (uid, side, col, row) => ({ uid, side, kind: 'drone', cardId: '167', label: `Pholcus ${uid}`, col, row, facing: 0, size: 1,
  aerial: false, deployed: true, statuses: [], log: [], ammo: {}, partStates: { main: 'intact' } });
const board = (tokens, first) => ({ v: 3, map: '', tokens, nextUid: 100, round: { n: 2, phase: 2, firstPlayer: first }, commandTokens: { s1: 0, s2: 0 } });
const send = (s, cmd) => {
  const v = U.check(data, s, cmd);
  if (v.ok) U.apply(data, s, cmd);
  return v;
};
const jump = (uid, targetUid) => ({ kind: 'flyToTarget', seat: 's1', uid, actionId: '167_A', targetUid });

// The Supplement's own example: Mines A and B, Black's, in one Grid (cells 3
// to 5); White's Pholcus C one Grid away, inside its Range of 1.
const ex = board([mineOf(1, 's2', 3, 3), mineOf(2, 's2', 5, 5), pholcus(50, 's1', 7, 4)], 's2');
check('before the jump nothing is owed', U.minesOwed(data, ex.tokens).length, 0);
check('the Pholcus jumps into its target\'s Grid', send(ex, jump(50, 1)).ok, true);
const c = ex.tokens.find((t) => t.uid === 50);
check('it lands in that Grid, marked as having jumped', [Math.floor(c.col / 3), Math.floor(c.row / 3), c.jumpBlast], [1, 1, true]);
check('a Ground Unit entered, so both Mines go off, and wait on the Pholcus',
  U.minesOwed(data, ex.tokens).map((m) => [m.uid, m.walker, m.heldBy]), [[1, 50, 50], [2, 50, 50]]);
check('none may resolve yet', [U.blastsReady(data, ex.tokens).length, U.blastTurn(data, ex)], [0, null]);
const held = send(ex, { kind: 'despawn', seat: 's2', uid: 2, targetUid: 2 });
check('a Mine it set off is refused until its blast is done, and says why',
  [held.ok, /jumped into this Grid/.test(held.why ?? ''), /Supplementary Rules 1\.04, 1\.9/.test(held.why ?? '')], [false, true, true]);
check('its damage is refused too', U.check(data, ex, { kind: 'applyPenetration', seat: 's2', uid: 2, targetUid: 50, slot: 'main' }).ok, false);
const blast = send(ex, { kind: 'applyPenetration', seat: 's1', uid: 50, targetUid: 1, slot: 'main' });
check('the Pholcus\'s own blast resolves first, and destroys its target, Mine A', [blast.ok, ex.tokens.find((t) => t.uid === 1).partStates.main], [true, 'destroyed']);
check('then the Pholcus leaves with its blast', send(ex, { kind: 'despawn', seat: 's1', uid: 50, targetUid: 50 }).ok, true);
check('Mine A, destroyed, never goes off; Mine B still does', U.blastsReady(data, ex.tokens).map((m) => m.uid), [2]);
check('and Black resolves it', [U.blastTurn(data, ex), send(ex, { kind: 'despawn', seat: 's2', uid: 2, targetUid: 2 }).ok], ['s2', true]);

// Both squads' Mines in the Grid it lands in: after the Pholcus, the usual
// round-robin from this round's First Player.
const mix = board([mineOf(1, 's2', 3, 3), mineOf(2, 's1', 5, 5), mineOf(3, 's2', 4, 5), pholcus(50, 's1', 7, 4)], 's2');
send(mix, jump(50, 1));
check('every Mine there waits on the Pholcus, its own squad\'s too', U.minesOwed(data, mix.tokens).every((m) => m.heldBy === 50), true);
send(mix, { kind: 'despawn', seat: 's1', uid: 50, targetUid: 50 });
check('then the squads take turns from the First Player', [U.blastsReady(data, mix.tokens).length, U.blastTurn(data, mix)], [3, 's2']);

// Set off together, the two never catch each other, though the Pholcus that
// set them off has gone: "A and B still detonate normally" (1.9; FAQ I13).
const pair = board([mineOf(1, 's2', 3, 3), mineOf(2, 's2', 5, 5), pholcus(50, 's1', 7, 4)], 's2');
send(pair, jump(50, 1));
send(pair, { kind: 'despawn', seat: 's1', uid: 50, targetUid: 50 });
const [pa, pb] = [pair.tokens.find((t) => t.uid === 1), pair.tokens.find((t) => t.uid === 2)];
check('the Mines a Pholcus set off never catch each other once it has gone',
  [U.detonationBar(pair.tokens, pa, act('074', '074_A'), [pb], pb), U.detonationBar(pair.tokens, pb, act('074', '074_A'), [pa], pa)], ['a Mine', 'a Mine']);
// The control, FAQ M6: a Mine placed into a mined Grid later sets the old one
// off, and the old one's blast may catch it.
const m6 = board([{ ...mineOf(1, 's2', 3, 3), mine: { batch: 'first' } }, { ...mineOf(2, 's1', 5, 5), mine: { batch: 'later' } }], 's2');
check('the control: an old Mine set off by a newer one placed on it may catch it (M6)',
  [U.minesOwed(data, m6.tokens).map((m) => m.uid), U.detonationBar(m6.tokens, m6.tokens[0], act('074', '074_A'), [m6.tokens[1]], m6.tokens[1])], [[1], '']);

// Its card: "If an Enemy Unit is within range", once.
const own = board([mineOf(1, 's2', 3, 3), mineOf(5, 's1', 4, 4), pholcus(50, 's1', 7, 4)], 's1');
check('a Pholcus jumps only at an Enemy Unit', send(own, jump(50, 5)).ok, false);
check('and only once', [send(own, jump(50, 1)).ok, send(own, jump(50, 1)).ok], [true, false]);
check('a Grid with no Mine holds nothing', (() => {
  const bare = board([{ ...walker, side: 's2', uid: 60 }, pholcus(50, 's1', 7, 4)], 's1');
  return [send(bare, jump(50, 60)).ok, U.minesOwed(data, bare.tokens).length];
})(), [true, 0]);

check('migrateState keeps the jump, and only a true one',
  [U.migrateState(board([{ ...pholcus(50, 's1', 4, 4), jumpBlast: true }], 's1'), data).tokens[0].jumpBlast,
    U.migrateState(board([{ ...pholcus(50, 's1', 4, 4), jumpBlast: 'yes' }], 's1'), data).tokens[0].jumpBlast],
  [true, undefined]);
check('a drift in it is a desync the fingerprint sees',
  U.boardFingerprint(board([{ ...pholcus(50, 's1', 4, 4), jumpBlast: true }], 's1')) === U.boardFingerprint(board([pholcus(50, 's1', 4, 4)], 's1')), false);

// ---------- the pages ----------
{
  const hud = src('../src/matchhud.ts');
  const jumpAt = hud.indexOf("if (jumpsToTarget(a) && !proj.jumpBlast) {");
  check('the Match Centre jumps the Pholcus before its Explosion starts, and its Mine panel skips the Mines that wait',
    [jumpAt > 0 && jumpAt < hud.indexOf("ctx.startAttack(proj.uid, detonateNow.actionId, target.uid, 'explosion');"),
      /function mineTriggers\(ctx: HudCtx\): \{ trigger: MineTrigger; t: Token \}\[\] \{\s*return blastsReady\(/.test(hud)],
    [true, true]);
  const main = src('../src/main.ts');
  const tabJump = main.indexOf("if (jumpsToTarget(action) && !proj.jumpBlast");
  check('so does the tabletop',
    [tabJump > 0 && tabJump < main.indexOf("attackHelper.start(proj, action, target, 'Explosion damage: no line of sight or facing check.'"),
      /function sweepMines\(\): void \{[\s\S]{0,200}const owed = blastsReady\(data, state\.tokens\);/.test(main)],
    [true, true]);
}
// ---------- a table with no board (the pad) ----------
// Every unit and Mine there stands on one placeholder cell, so a Mine beside a
// newer one reads as set off (M6) with nothing entering anything. The table
// resolves its own Mines, in its own order: nothing is refused.
{
  const pad = { ...board([{ ...mineOf(1, 's1', 0, 0), mine: { batch: 'a' } }, { ...mineOf(2, 's2', 0, 0), mine: { batch: 'b' } },
    { ...mineOf(3, 's1', 0, 0), mine: { batch: 'c' } }, { ...walker, uid: 60, col: 0, row: 0 }], 's2'), noBoard: true };
  const boarded = JSON.parse(JSON.stringify({ ...pad, noBoard: undefined }));
  check('the control: with a board, the same Mines keep 1.9\'s turn and the other squad waits',
    U.check(data, boarded, { kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 60, slot: 'torso' }).ok, false);
  check('on a pad table both squads\' Mines can read as set off, off the placeholder cells',
    [...new Set(U.minesOwed(data, pad.tokens).map((m) => pad.tokens.find((t) => t.uid === m.uid).side))].sort(), ['s1', 's2']);
  check('and neither squad\'s record is refused: the table keeps the order',
    [U.check(data, pad, { kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 60, slot: 'torso' }).ok, send(pad, { kind: 'despawn', seat: 's1', uid: 1, targetUid: 1 }).ok, 'blastLast' in pad],
    [true, true, false]);
  const padSrc = src('../pad/pad.ts');
  check('the pad\'s detonation prompt says the order for the table to keep',
    [/jumpsToTarget\(a\) \? ' It jumps into that unit\\'s Grid first: a Mine there goes off after this blast/.test(padSrc),
      /proj\.mine \? ` If both squads' Mines went off together, \$\{sideName\(table\.round\.firstPlayer\)\} resolves one first/.test(padSrc)],
    [true, true]);
}
check('both boards take the Pholcus off as its blast ends, as they do a spent Projectile',
  [/const spent = attacker\.kind === 'projectile' \|\| action\.type === 'Detonation';/.test(src('../src/match.ts')),
    /if \(attacker\.kind === 'projectile' \|\| action\.type === 'Detonation'\) \{/.test(src('../src/main.ts'))],
  [true, true]);
check('the Match Centre shows only the squad on turn its blasts, one button each, and the other waits',
  [/const mineNow = all\.filter\(\(x\) => !turn \|\| x\.t\.side === turn\);/.test(src('../src/matchhud.ts')),
    /head\('Waiting', 'Simultaneous damage'/.test(src('../src/matchhud.ts'))],
  [true, true]);
check('the tabletop releases the held blast of the squad on turn',
  /const at = turn \? heldBlasts\.findIndex\(\(b\) => state\.tokens\.find\(\(x\) => x\.uid === b\.uid\)\?\.side === turn\) : -1;/.test(src('../src/main.ts')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
