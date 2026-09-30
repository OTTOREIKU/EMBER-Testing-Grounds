// A sealed Tactics hand (Supplementary Rules 1.04, 1.11: a squad's Tactics
// Cards are hidden information, revealed to the opponent only when played).
// OTTO, 2026-09-30: "we just need to adjust the hidden mechanic in the
// engine/pad". Across a room each seat publishes one commitment per card and
// keeps the cards and salts on its own device; a card is proved against its
// commitment when it is played. Driven through the real engine, bundled.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Tactics Cards: hidden until played\n');

installDom();
// A working store: a sealed hand's secret half lives here on the device.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const entry = new URL('./_tactichand.entry.ts', import.meta.url);
const out = new URL('./_tactichand.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { check, apply } from '../src/commands';",
  "export { newScriptState } from '../src/types';",
  "export { migrateState, squadPoints } from '../src/units';",
  "export { boardFingerprint, sealTactic, sha256Hex } from '../src/secrecy';",
  "export * as H from '../src/tactichand';",
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

// ---------- the digest ----------
const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'tactic|274|00ff', '黑曜协议 ✓'];
check('the commitment\'s SHA-256 is the standard one, block edges and UTF-8 included',
  inputs.filter((x) => U.sha256Hex(x) !== createHash('sha256').update(x, 'utf8').digest('hex')), []);

// ---------- sealing ----------
const tactics = data.cards.filter((c) => c.category === 'tactics_or_upgrade').map((c) => c.id).slice(0, 3);
const [A, B, C] = tactics;
check('the data holds Tactics Cards to test with', tactics.length, 3);
check('at one table the hand stays plain', U.H.handCommand('s1', [A, B], null), { kind: 'setTactics', seat: 's1', cards: [A, B] });
const sealedCmd = U.H.handCommand('s1', [A, B], 'ROOM1');
check('across a room it is sealed: two sorted 64-digit commitments, and no card named',
  [sealedCmd.kind, sealedCmd.cards, sealedCmd.sealed.length, sealedCmd.sealed.every((h) => /^[0-9a-f]{64}$/.test(h)),
    [...sealedCmd.sealed].sort().join() === sealedCmd.sealed.join(), JSON.stringify(sealedCmd).includes(`"${A}"`) || JSON.stringify(sealedCmd).includes(`"${B}"`)],
  ['setTactics', undefined, 2, true, true, false]);

// One Mech for a card to act through: the engine finds the acting unit before
// it asks about the hand.
const mech = () => ({ uid: 1, side: 's1', kind: 'mech', cardId: '012', label: 'M1', col: 3, row: 3, facing: 0, size: 'medium',
  stance: 'offensive', link: 3, deployed: true, statuses: [], log: [], partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' },
  mech: { torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2' } });
const table = () => ({ v: 3, map: '', tokens: [mech()], nextUid: 2, round: { n: 1, phase: 0, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 } });
const s = table();
check('the engine takes a sealed hand before the game', U.check(data, s, sealedCmd).ok, true);
U.apply(data, s, sealedCmd);
check('and the table then carries commitments, not cards',
  [s.tactics.s1, s.tacticsSealed.s1.length, JSON.stringify(s).includes(`"${A}"`)], [[], 2, false]);
check('a malformed seal is refused',
  [U.check(data, s, { kind: 'setTactics', seat: 's1', sealed: ['nothex'] }).ok, U.check(data, s, { kind: 'setTactics', seat: 's1', sealed: Array(9).fill('a'.repeat(64)) }).ok],
  [false, false]);

// ---------- reading it ----------
check('this device reads its own sealed hand back; another room or no room reads nothing',
  [U.H.handIds(s, 's1', 'ROOM1'), U.H.handIds(s, 's1', 'OTHER'), U.H.handIds(s, 's1', null)], [[A, B], [], []]);
check('anyone can count it, and it is marked sealed', [U.H.handCount(s, 's1'), U.H.handSealed(s, 's1'), U.H.handSealed(s, 's2')], [2, true, false]);
check('a sealed hand this device cannot see still costs its points, 30 a card',
  U.squadPoints(data, [], 's1', [], U.H.handCount(s, 's1')), 60);

// ---------- playing a card ----------
const salt = U.H.saltFor(s, 's1', A, 'ROOM1');
const play = (extra) => U.check(data, s, { kind: 'playTactic', seat: 's1', uid: 1, cardId: A, ...extra });
const notInHand = (v) => /is not in this squad's hand/.test(v.why ?? '');
check('a card played without its salt, or with the wrong one, is not in the hand',
  [notInHand(play({})), notInHand(play({ salt: '00'.repeat(16) }))], [true, true]);
check('with its salt the hand accepts it (what else the card needs is judged after)', notInHand(play({ salt })), false);
check('a card the hand never held cannot borrow another card\'s salt', notInHand(U.check(data, s, { kind: 'playTactic', seat: 's1', uid: 1, cardId: C, salt })), true);
check('the salt is what proves it: the commitment is the card and its salt',
  s.tacticsSealed.s1.includes(U.sealTactic(A, salt)), true);

// ---------- travelling ----------
check('migrateState keeps a sealed hand and drops anything else',
  [U.migrateState({ ...table(), tacticsSealed: { s1: s.tacticsSealed.s1 } }, data).tacticsSealed?.s1?.length,
    U.migrateState({ ...table(), tacticsSealed: { s1: ['<b>x</b>'] } }, data).tacticsSealed,
    U.migrateState({ ...table(), tacticsSealed: 'x' }, data).tacticsSealed],
  [2, undefined, undefined]);
check('a drift in the commitments is a desync the fingerprint sees',
  U.boardFingerprint(s) === U.boardFingerprint({ ...s, tacticsSealed: { s1: [s.tacticsSealed.s1[0]] } }), false);
const plain = table();
U.apply(data, plain, { kind: 'setTactics', seat: 's1', cards: [A] });
U.apply(data, plain, sealedCmd);
U.apply(data, plain, { kind: 'setTactics', seat: 's1', cards: [C] });
check('a plain hand after a sealed one clears the seal', [plain.tactics.s1, 'tacticsSealed' in plain], [[C], false]);

// ---------- the pages ----------
const pad = src('../pad/pad.ts'), match = src('../src/match.ts'), hud = src('../src/matchhud.ts'), main = src('../src/main.ts');
const plainSends = (text) => (text.match(/kind: 'setTactics', seat(: \w+)?, cards: (?!\[\])/g) ?? []).length;
check('no page sends a hand in the clear except through the shared module (clearing one is fine)',
  [plainSends(pad), plainSends(match), plainSends(main)], [0, 0, 0]);
check('the pad seals in a room and proves its plays',
  [/return send\(handCommand\(seat, ids, roomKey\(\)\)\);/.test(pad), /const salt = saltFor\(table, side, cardId, roomKey\(\)\);/.test(pad), /return solo \? null : view\.room\?\.id \?\? null;/.test(pad)],
  [true, true, true]);
check('the Match Centre seals its squad\'s hand and proves its plays',
  [/perform\(data, state, handCommand\(seat, merged, roomKey\(\)\)\);/.test(match), /const salt = saltFor\(ctx\.state, m\.side, m\.cardId, ctx\.room\);/.test(hud)],
  [true, true]);
check('the tabletop too, and its squad panel counts a hand it cannot see',
  [/perform\(data, state, handCommand\(side, merged, handRoom\)\);/.test(main), /setHandRoom\(handRoom\);/.test(main), /let hidden = sealedAway \? total - held\.length : 0;/.test(src('../src/squads.ts'))],
  [true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
